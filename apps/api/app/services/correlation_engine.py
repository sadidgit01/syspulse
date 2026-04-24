import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import logging

from fastapi import HTTPException, status
from sqlalchemy import desc, distinct, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, CorrelationEvent, LogEntry, Metric
from app.redis_client import correlation_channel, publish_json
from app.schemas.log import (
    CorrelationEventRead,
    CorrelationSeverity,
    CorrelationStoredLogSnippet,
    LogLevel,
    SpikeMetric,
)

logger = logging.getLogger(__name__)


class CorrelationEngine:
    @staticmethod
    async def analyze(
        session: AsyncSession,
        org_id: uuid.UUID,
        window_minutes: int = 10,
    ) -> list[CorrelationEventRead]:
        if window_minutes <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="window_minutes must be greater than zero.",
            )

        window_end = datetime.now(timezone.utc)
        window_start = window_end - timedelta(minutes=window_minutes)

        metrics = (
            await session.scalars(
                select(Metric)
                .where(
                    Metric.org_id == org_id,
                    Metric.time >= window_start,
                    Metric.time <= window_end,
                )
                .order_by(Metric.agent_id.asc(), Metric.time.asc())
            )
        ).all()
        error_logs = (
            await session.scalars(
                select(LogEntry)
                .where(
                    LogEntry.org_id == org_id,
                    LogEntry.level.in_([LogLevel.ERROR.value, LogLevel.CRITICAL.value]),
                    LogEntry.time >= window_start,
                    LogEntry.time <= window_end,
                )
                .order_by(LogEntry.agent_id.asc(), LogEntry.time.asc())
            )
        ).all()

        metrics_by_agent: dict[uuid.UUID, list[Metric]] = defaultdict(list)
        logs_by_agent: dict[uuid.UUID, list[LogEntry]] = defaultdict(list)
        for metric in metrics:
            metrics_by_agent[metric.agent_id].append(metric)
        for log_entry in error_logs:
            logs_by_agent[log_entry.agent_id].append(log_entry)

        event_payloads: list[dict[str, object]] = []
        for agent_id, agent_metrics in metrics_by_agent.items():
            correlated_agent_logs = logs_by_agent.get(agent_id, [])
            event_payloads.extend(
                _detect_correlation_events(
                    org_id=org_id,
                    agent_id=agent_id,
                    metrics=agent_metrics,
                    logs=correlated_agent_logs,
                )
            )

        if not event_payloads:
            return []

        statement = (
            pg_insert(CorrelationEvent)
            .values(event_payloads)
            .on_conflict_do_nothing(
                constraint="uq_correlation_events_org_agent_metric_time"
            )
            .returning(CorrelationEvent)
        )
        inserted_rows = (await session.scalars(statement)).all()
        await session.commit()

        events = [_serialize_correlation_event(row) for row in inserted_rows]
        for event in events:
            try:
                await publish_json(
                    correlation_channel(org_id),
                    event.model_dump(mode="json"),
                )
            except Exception:
                logger.exception("Failed to publish correlation event for org %s", org_id)
        return events

    @staticmethod
    async def get_recent(
        session: AsyncSession,
        org_id: uuid.UUID,
        limit: int = 20,
    ) -> list[CorrelationEventRead]:
        if limit <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="limit must be greater than zero.",
            )

        rows = (
            await session.scalars(
                select(CorrelationEvent)
                .where(CorrelationEvent.org_id == org_id)
                .order_by(desc(CorrelationEvent.created_at), desc(CorrelationEvent.spike_time))
                .limit(limit)
            )
        ).all()
        return [_serialize_correlation_event(row) for row in rows]

    @staticmethod
    async def get_active_org_ids(
        session: AsyncSession,
        active_within_minutes: int = 5,
    ) -> list[uuid.UUID]:
        if active_within_minutes <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="active_within_minutes must be greater than zero.",
            )

        threshold = datetime.now(timezone.utc) - timedelta(minutes=active_within_minutes)
        rows = (
            await session.scalars(
                select(distinct(Metric.org_id))
                .join(
                    Agent,
                    (Agent.id == Metric.agent_id) & (Agent.org_id == Metric.org_id),
                )
                .where(
                    Metric.time >= threshold,
                    Agent.last_seen >= threshold,
                )
            )
        ).all()
        return list(rows)


def _detect_correlation_events(
    *,
    org_id: uuid.UUID,
    agent_id: uuid.UUID,
    metrics: list[Metric],
    logs: list[LogEntry],
) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    if len(metrics) < 2:
        return results

    running_totals = {"cpu": 0.0, "memory": 0.0, "disk": 0.0}
    prior_count = 0

    for metric in metrics:
        if prior_count > 0:
            rolling_averages = {
                key: running_totals[key] / prior_count for key in running_totals
            }

            for metric_name, current_value in (
                (SpikeMetric.CPU.value, float(metric.cpu)),
                (SpikeMetric.MEMORY.value, float(metric.memory)),
                (SpikeMetric.DISK.value, float(metric.disk)),
            ):
                rolling_average = rolling_averages[metric_name]
                if rolling_average <= 0:
                    continue
                if current_value <= 60:
                    continue
                if current_value <= rolling_average * 1.5:
                    continue

                correlated_logs = [
                    log_entry
                    for log_entry in logs
                    if abs((log_entry.time - metric.time).total_seconds()) <= 120
                ]
                if not correlated_logs:
                    continue

                score = _compute_correlation_score(
                    spike_value=current_value,
                    rolling_average=rolling_average,
                    log_count=len(correlated_logs),
                )
                severity = _determine_severity(
                    spike_value=current_value,
                    correlation_score=score,
                    logs=correlated_logs,
                )
                results.append(
                    {
                        "org_id": org_id,
                        "agent_id": agent_id,
                        "spike_metric": metric_name,
                        "spike_value": current_value,
                        "spike_time": metric.time,
                        "correlated_logs": [
                            {
                                "id": str(log_entry.id),
                                "time": log_entry.time.isoformat(),
                                "level": log_entry.level,
                                "source": log_entry.source,
                                "message": log_entry.message,
                            }
                            for log_entry in correlated_logs
                        ],
                        "severity": severity.value,
                        "correlation_score": score,
                    }
                )

        running_totals["cpu"] += float(metric.cpu)
        running_totals["memory"] += float(metric.memory)
        running_totals["disk"] += float(metric.disk)
        prior_count += 1

    return results


def _compute_correlation_score(
    *,
    spike_value: float,
    rolling_average: float,
    log_count: int,
) -> float:
    spike_magnitude = max(0.0, (spike_value - rolling_average) / max(rolling_average, 1.0))
    raw_score = (spike_magnitude * max(log_count, 1)) / 3.0
    return round(min(1.0, raw_score), 4)


def _determine_severity(
    *,
    spike_value: float,
    correlation_score: float,
    logs: list[LogEntry],
) -> CorrelationSeverity:
    if (
        any(log_entry.level == LogLevel.CRITICAL.value for log_entry in logs)
        or spike_value >= 85
        or correlation_score >= 0.75
    ):
        return CorrelationSeverity.CRITICAL
    return CorrelationSeverity.WARNING


def _serialize_correlation_event(row: CorrelationEvent) -> CorrelationEventRead:
    correlated_logs = row.correlated_logs or []
    return CorrelationEventRead(
        id=row.id,
        org_id=row.org_id,
        agent_id=row.agent_id,
        spike_metric=SpikeMetric(row.spike_metric),
        spike_value=float(row.spike_value),
        spike_time=row.spike_time,
        correlated_logs=[
            CorrelationStoredLogSnippet.model_validate(item) for item in correlated_logs
        ],
        severity=CorrelationSeverity(row.severity),
        correlation_score=float(row.correlation_score),
        created_at=row.created_at,
    )
