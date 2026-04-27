import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from opentelemetry import trace
from sqlalchemy import desc, func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Metric
from app.redis_client import metrics_channel, publish_json
from app.services.anomaly_detector import anomaly_detector
from app.schemas.auth import UserIdentity
from app.schemas.metric import (
    MetricBatchIngestRequest,
    MetricPointResponse,
    MetricResolution,
)

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)


class MetricService:
    @staticmethod
    async def ingest_metrics(
        session: AsyncSession,
        agent: Agent,
        payload: MetricBatchIngestRequest,
    ) -> int:
        latest_snapshot = max(payload.root, key=lambda item: item.timestamp)
        with tracer.start_as_current_span("metric.ingest") as span:
            span.set_attribute("agent_id", str(agent.id))
            span.set_attribute("org_id", str(agent.org_id))
            span.set_attribute("batch_size", len(payload.root))
            span.set_attribute("timestamp", latest_snapshot.timestamp.isoformat())

            records = [
                {
                    "org_id": agent.org_id,
                    "agent_id": agent.id,
                    "time": item.timestamp,
                    "cpu": item.cpu_percent,
                    "memory": item.memory_percent,
                    "disk": item.disk_percent,
                    "net_in": item.net_bytes_in,
                    "net_out": item.net_bytes_out,
                }
                for item in payload.root
            ]
            agent.last_seen = latest_snapshot.timestamp

            try:
                await session.execute(insert(Metric), records)
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="One or more metric snapshots conflict with existing records.",
                ) from exc

            try:
                await publish_json(
                    metrics_channel(agent.org_id),
                    {
                        "agent_id": str(agent.id),
                        "org_id": str(agent.org_id),
                        "timestamp": latest_snapshot.timestamp.isoformat(),
                        "cpu_percent": latest_snapshot.cpu_percent,
                        "memory_percent": latest_snapshot.memory_percent,
                        "disk_percent": latest_snapshot.disk_percent,
                        "net_bytes_in": latest_snapshot.net_bytes_in,
                        "net_bytes_out": latest_snapshot.net_bytes_out,
                    },
                )
            except Exception:
                logger.exception("Failed to publish metric update for org %s", agent.org_id)

            try:
                latest_snapshot_payload = _build_snapshot_payload(agent, latest_snapshot)
                anomaly = anomaly_detector.predict(agent.id, latest_snapshot_payload)
                if anomaly.is_anomaly:
                    event = await anomaly_detector.record_event(
                        session=session,
                        org_id=agent.org_id,
                        agent_id=agent.id,
                        result=anomaly,
                        snapshot=latest_snapshot_payload,
                    )
                    from app.tasks.anomaly_task import enrich_anomaly_explanation

                    enrich_anomaly_explanation.delay(str(event.id))
            except Exception:
                logger.exception("Failed to process anomaly detection for agent %s", agent.id)

            return len(records)

    @staticmethod
    async def list_metrics(
        session: AsyncSession,
        user: UserIdentity,
        agent_id: UUID,
        from_time: datetime | None,
        to_time: datetime | None,
        resolution: MetricResolution,
    ) -> list[MetricPointResponse]:
        if from_time is not None and from_time.tzinfo is None:
            from_time = from_time.replace(tzinfo=timezone.utc)
        if from_time is not None and from_time.tzinfo is not None:
            from_time = from_time.astimezone(timezone.utc)
        if to_time is not None and to_time.tzinfo is None:
            to_time = to_time.replace(tzinfo=timezone.utc)
        if to_time is not None and to_time.tzinfo is not None:
            to_time = to_time.astimezone(timezone.utc)
        if from_time and to_time and from_time > to_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The from timestamp must be earlier than the to timestamp.",
            )

        agent = await session.scalar(
            select(Agent).where(
                Agent.id == agent_id,
                Agent.org_id == user.org_id,
            )
        )
        if agent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Agent not found.",
            )

        filters = [
            Metric.org_id == user.org_id,
            Metric.agent_id == agent_id,
        ]
        if from_time is not None:
            filters.append(Metric.time >= from_time)
        if to_time is not None:
            filters.append(Metric.time <= to_time)

        if resolution == MetricResolution.RAW:
            statement = select(Metric).where(*filters).order_by(desc(Metric.time))
            if from_time is None and to_time is None:
                statement = statement.limit(100)
            metrics = (await session.scalars(statement)).all()
            points = [
                MetricPointResponse(
                    timestamp=metric.time,
                    cpu_percent=metric.cpu,
                    memory_percent=metric.memory,
                    disk_percent=metric.disk,
                    net_bytes_in=metric.net_in,
                    net_bytes_out=metric.net_out,
                )
                for metric in reversed(metrics)
            ]
            return points

        bucket_size = {
            MetricResolution.ONE_MINUTE: "1 minute",
            MetricResolution.FIVE_MINUTES: "5 minutes",
            MetricResolution.ONE_HOUR: "1 hour",
        }[resolution]
        bucket = func.time_bucket(bucket_size, Metric.time).label("timestamp")
        statement = (
            select(
                bucket,
                func.avg(Metric.cpu).label("cpu_percent"),
                func.avg(Metric.memory).label("memory_percent"),
                func.avg(Metric.disk).label("disk_percent"),
                func.avg(Metric.net_in).label("net_bytes_in"),
                func.avg(Metric.net_out).label("net_bytes_out"),
            )
            .where(*filters)
            .group_by(bucket)
            .order_by(desc(bucket))
        )
        if from_time is None and to_time is None:
            statement = statement.limit(100)
        rows = (await session.execute(statement)).all()
        points = [
            MetricPointResponse(
                timestamp=row.timestamp,
                cpu_percent=float(row.cpu_percent or 0.0),
                memory_percent=float(row.memory_percent or 0.0),
                disk_percent=float(row.disk_percent or 0.0),
                net_bytes_in=float(row.net_bytes_in or 0.0),
                net_bytes_out=float(row.net_bytes_out or 0.0),
            )
            for row in reversed(rows)
        ]
        return points


def _build_snapshot_payload(agent: Agent, snapshot: Any) -> dict[str, Any]:
    return {
        "timestamp": snapshot.timestamp.isoformat(),
        "agent_id": str(agent.id),
        "org_id": str(agent.org_id),
        "cpu_percent": float(snapshot.cpu_percent),
        "memory_percent": float(snapshot.memory_percent),
        "disk_percent": float(snapshot.disk_percent),
        "net_bytes_in": float(snapshot.net_bytes_in),
        "net_bytes_out": float(snapshot.net_bytes_out),
    }
