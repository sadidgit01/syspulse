import json
import logging
import math
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import String, case, cast, desc, func, insert, literal, select, union_all
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, LogEntry, Metric
from app.redis_client import alerts_candidates_channel, logs_channel, publish_json
from app.schemas.auth import UserIdentity
from app.schemas.log import (
    CorrelationEvent,
    CorrelationResponse,
    LogBatchIngestRequest,
    LogEntryRead,
    LogErrorRatePoint,
    LogLevel,
    LogLevelCount,
    LogsQueryResponse,
    LogSourceCount,
    LogStatsResponse,
)

logger = logging.getLogger(__name__)


class LogService:
    @staticmethod
    async def ingest_logs(
        session: AsyncSession,
        agent: Agent,
        payload: LogBatchIngestRequest,
    ) -> int:
        entries = [
            {
                "id": uuid.uuid4(),
                "time": item.timestamp,
                "agent_id": agent.id,
                "org_id": agent.org_id,
                "level": item.level.value,
                "source": item.source,
                "message": item.message,
            }
            for item in payload.root
        ]
        latest_entry = max(payload.root, key=lambda item: item.timestamp)
        agent.last_seen = latest_entry.timestamp

        try:
            await session.execute(insert(LogEntry), entries)
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="One or more log entries conflict with existing records.",
            ) from exc

        for entry in entries:
            payload = {
                "id": str(entry["id"]),
                "timestamp": entry["time"].isoformat(),
                "agent_id": str(entry["agent_id"]),
                "org_id": str(entry["org_id"]),
                "level": entry["level"],
                "source": entry["source"],
                "message": entry["message"],
            }
            try:
                await publish_json(logs_channel(agent.org_id), payload)
                if entry["level"] in {LogLevel.ERROR.value, LogLevel.CRITICAL.value}:
                    await publish_json(alerts_candidates_channel(agent.org_id), payload)
            except Exception:
                logger.exception("Failed to publish log update for org %s", agent.org_id)

        return len(entries)

    @staticmethod
    async def list_logs(
        session: AsyncSession,
        user: UserIdentity,
        *,
        agent_id: uuid.UUID | None,
        levels: list[LogLevel],
        source: str | None,
        search: str | None,
        from_time: datetime | None,
        to_time: datetime | None,
        page: int,
        page_size: int,
    ) -> LogsQueryResponse:
        from_time, to_time = _normalize_time_range(from_time, to_time)
        await _validate_agent_scope(session, user.org_id, agent_id)

        filters = _build_log_filters(
            org_id=user.org_id,
            agent_id=agent_id,
            levels=levels,
            source=source,
            search=search,
            from_time=from_time,
            to_time=to_time,
        )

        total = int(
            await session.scalar(select(func.count()).select_from(LogEntry).where(*filters)) or 0
        )
        pages = max(1, math.ceil(total / page_size)) if page_size else 1

        statement = (
            select(LogEntry)
            .where(*filters)
            .order_by(desc(LogEntry.time), desc(LogEntry.id))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        rows = (await session.scalars(statement)).all()

        return LogsQueryResponse(
            logs=[
                LogEntryRead(
                    id=row.id,
                    time=row.time,
                    agent_id=row.agent_id,
                    org_id=row.org_id,
                    level=LogLevel(row.level),
                    source=row.source,
                    message=row.message,
                )
                for row in rows
            ],
            total=total,
            page=page,
            pages=pages,
        )

    @staticmethod
    async def get_stats(
        session: AsyncSession,
        user: UserIdentity,
        *,
        agent_id: uuid.UUID | None,
        from_time: datetime,
        to_time: datetime,
    ) -> LogStatsResponse:
        from_time, to_time = _normalize_time_range(from_time, to_time)
        if from_time is None or to_time is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both from and to timestamps are required.",
            )
        await _validate_agent_scope(session, user.org_id, agent_id)

        filters = _build_log_filters(
            org_id=user.org_id,
            agent_id=agent_id,
            level=None,
            source=None,
            search=None,
            from_time=from_time,
            to_time=to_time,
        )

        levels_result = (
            await session.execute(
                select(LogEntry.level, func.count().label("count"))
                .where(*filters)
                .group_by(LogEntry.level)
            )
        ).all()
        level_counts = {LogLevel(row.level): int(row.count) for row in levels_result}
        levels = [
            LogLevelCount(level=level, count=level_counts.get(level, 0))
            for level in LogLevel
        ]

        sources_result = (
            await session.execute(
                select(LogEntry.source, func.count().label("count"))
                .where(*filters)
                .group_by(LogEntry.source)
                .order_by(desc("count"), LogEntry.source.asc())
            )
        ).all()
        sources = [
            LogSourceCount(source=row.source, count=int(row.count))
            for row in sources_result
        ]

        error_case = case(
            (LogEntry.level.in_([LogLevel.ERROR.value, LogLevel.CRITICAL.value]), 1),
            else_=0,
        )
        bucket = func.time_bucket("1 hour", LogEntry.time).label("timestamp")
        error_rate_rows = (
            await session.execute(
                select(
                    bucket,
                    func.count().label("total_logs"),
                    func.sum(error_case).label("error_logs"),
                )
                .where(*filters)
                .group_by(bucket)
                .order_by(bucket.asc())
            )
        ).all()
        error_rate_over_time = [
            LogErrorRatePoint(
                timestamp=row.timestamp,
                total_logs=int(row.total_logs or 0),
                error_logs=int(row.error_logs or 0),
                error_rate=(
                    float((row.error_logs or 0) / row.total_logs * 100.0)
                    if row.total_logs
                    else 0.0
                ),
            )
            for row in error_rate_rows
        ]

        return LogStatsResponse(
            levels=levels,
            sources=sources,
            error_rate_over_time=error_rate_over_time,
        )

    @staticmethod
    async def correlate(
        session: AsyncSession,
        user: UserIdentity,
        *,
        agent_id: uuid.UUID,
        from_time: datetime,
        to_time: datetime,
    ) -> CorrelationResponse:
        from_time, to_time = _normalize_time_range(from_time, to_time)
        if from_time is None or to_time is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both from and to timestamps are required.",
            )
        await _validate_agent_scope(session, user.org_id, agent_id, require_match=True)

        metric_events = (
            select(
                literal("metric").label("type"),
                Metric.time.label("timestamp"),
                cast(
                    func.jsonb_build_object(
                        "agent_id",
                        cast(Metric.agent_id, String),
                        "org_id",
                        cast(Metric.org_id, String),
                        "cpu_percent",
                        Metric.cpu,
                        "memory_percent",
                        Metric.memory,
                        "disk_percent",
                        Metric.disk,
                        "net_bytes_in",
                        Metric.net_in,
                        "net_bytes_out",
                        Metric.net_out,
                    ),
                    JSONB,
                ).label("data"),
            )
            .where(
                Metric.org_id == user.org_id,
                Metric.agent_id == agent_id,
                Metric.time >= from_time,
                Metric.time <= to_time,
            )
        )
        log_events = (
            select(
                literal("log").label("type"),
                LogEntry.time.label("timestamp"),
                cast(
                    func.jsonb_build_object(
                        "id",
                        cast(LogEntry.id, String),
                        "agent_id",
                        cast(LogEntry.agent_id, String),
                        "org_id",
                        cast(LogEntry.org_id, String),
                        "level",
                        LogEntry.level,
                        "source",
                        LogEntry.source,
                        "message",
                        LogEntry.message,
                    ),
                    JSONB,
                ).label("data"),
            )
            .where(
                LogEntry.org_id == user.org_id,
                LogEntry.agent_id == agent_id,
                LogEntry.time >= from_time,
                LogEntry.time <= to_time,
            )
        )

        combined = union_all(metric_events, log_events).subquery()
        rows = (
            await session.execute(
                select(combined.c.type, combined.c.timestamp, combined.c.data).order_by(
                    combined.c.timestamp.asc()
                )
            )
        ).all()

        events = [
            CorrelationEvent(
                type=row.type,
                timestamp=row.timestamp,
                data=_coerce_json_payload(row.data),
            )
            for row in rows
        ]
        return CorrelationResponse(events=events)


def _build_log_filters(
    *,
    org_id: uuid.UUID,
    agent_id: uuid.UUID | None,
    levels: list[LogLevel],
    source: str | None,
    search: str | None,
    from_time: datetime | None,
    to_time: datetime | None,
) -> list[object]:
    filters: list[object] = [LogEntry.org_id == org_id]
    if agent_id is not None:
        filters.append(LogEntry.agent_id == agent_id)
    if levels:
        filters.append(LogEntry.level.in_([level.value for level in levels]))
    if source:
        filters.append(LogEntry.source.ilike(f"%{source.strip()}%"))
    if search:
        filters.append(
            func.to_tsvector("english", LogEntry.message).op("@@")(
                func.plainto_tsquery("english", search.strip())
            )
        )
    if from_time is not None:
        filters.append(LogEntry.time >= from_time)
    if to_time is not None:
        filters.append(LogEntry.time <= to_time)
    return filters


def _normalize_time_range(
    from_time: datetime | None,
    to_time: datetime | None,
) -> tuple[datetime | None, datetime | None]:
    if from_time is not None:
        from_time = _normalize_datetime(from_time)
    if to_time is not None:
        to_time = _normalize_datetime(to_time)
    if from_time and to_time and from_time > to_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The from timestamp must be earlier than the to timestamp.",
        )
    return from_time, to_time


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def _validate_agent_scope(
    session: AsyncSession,
    org_id: uuid.UUID,
    agent_id: uuid.UUID | None,
    *,
    require_match: bool = False,
) -> None:
    if agent_id is None and not require_match:
        return
    if agent_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent_id is required.",
        )

    agent = await session.scalar(
        select(Agent).where(
            Agent.id == agent_id,
            Agent.org_id == org_id,
        )
    )
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found.",
        )


def _coerce_json_payload(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    return {}
