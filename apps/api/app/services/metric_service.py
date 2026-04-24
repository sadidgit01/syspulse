import logging
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Metric
from app.redis_client import metrics_channel, publish_json
from app.schemas.metric import MetricIngest, MetricRead

logger = logging.getLogger(__name__)


class MetricService:
    @staticmethod
    async def ingest_metric(session: AsyncSession, payload: MetricIngest) -> MetricRead:
        agent = await session.scalar(
            select(Agent).where(
                Agent.id == payload.agent_id,
                Agent.org_id == payload.org_id,
            )
        )
        if agent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Agent not found for the specified organization.",
            )

        metric = Metric(
            org_id=payload.org_id,
            agent_id=payload.agent_id,
            time=payload.time,
            cpu=payload.cpu,
            memory=payload.memory,
            disk=payload.disk,
            net_in=payload.net_in,
            net_out=payload.net_out,
        )
        session.add(metric)
        agent.last_seen = payload.time
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A metric for this agent and timestamp already exists within the organization.",
            ) from exc

        response = MetricRead.model_validate(metric)
        try:
            await publish_json(
                metrics_channel(payload.org_id),
                response.model_dump(mode="json"),
            )
        except Exception:
            logger.exception("Failed to publish metric update for org %s", payload.org_id)

        return response

    @staticmethod
    async def list_metrics(
        session: AsyncSession,
        org_id: UUID,
        agent_id: UUID,
        start_time: datetime | None,
        end_time: datetime | None,
        limit: int,
    ) -> list[MetricRead]:
        if start_time and end_time and start_time > end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The start timestamp must be earlier than the end timestamp.",
            )

        statement = select(Metric).where(
            Metric.org_id == org_id,
            Metric.agent_id == agent_id,
        )
        if start_time is not None:
            statement = statement.where(Metric.time >= start_time)
        if end_time is not None:
            statement = statement.where(Metric.time <= end_time)

        statement = statement.order_by(desc(Metric.time)).limit(limit)
        result = await session.scalars(statement)
        return [MetricRead.model_validate(metric) for metric in result.all()]
