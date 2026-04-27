import asyncio
import json
from contextlib import suppress
from datetime import datetime
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_agent, get_user_from_access_token, require_role, verify_agent_signature
from app.database import get_session
from app.models import Agent, UserRole
from app.redis_client import create_pubsub, logs_channel
from app.schemas.agent import AgentIdentity
from app.schemas.auth import UserIdentity
from app.schemas.log import (
    RecentCorrelationEventsResponse,
    CorrelationResponse,
    LogBatchIngestRequest,
    LogLevel,
    LogsQueryResponse,
    LogStatsResponse,
)
from app.schemas.metric import IngestAcceptedResponse
from app.services.correlation_engine import CorrelationEngine
from app.services.log_service import LogService

router = APIRouter()


@router.post("/ingest/logs", response_model=IngestAcceptedResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_logs(
    request: Request,
    _: None = Depends(verify_agent_signature),
    identity: AgentIdentity = Depends(get_current_agent),
    session: AsyncSession = Depends(get_session),
) -> IngestAcceptedResponse:
    try:
        payload = LogBatchIngestRequest.model_validate(await request.json())
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(),
        ) from exc

    agent = await session.scalar(
        select(Agent).where(
            Agent.id == identity.agent_id,
            Agent.org_id == identity.org_id,
        )
    )
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Agent token is no longer valid.",
        )
    accepted = await LogService.ingest_logs(session=session, agent=agent, payload=payload)
    return IngestAcceptedResponse(accepted=accepted)


@router.get("/logs", response_model=LogsQueryResponse)
async def get_logs(
    agent_id: UUID | None = Query(default=None),
    level: list[LogLevel] = Query(default_factory=list),
    source: str | None = Query(default=None, min_length=1, max_length=255),
    search: str | None = Query(default=None, min_length=1),
    from_time: datetime | None = Query(default=None, alias="from"),
    to_time: datetime | None = Query(default=None, alias="to"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> LogsQueryResponse:
    return await LogService.list_logs(
        session=session,
        user=user,
        agent_id=agent_id,
        levels=level,
        source=source,
        search=search,
        from_time=from_time,
        to_time=to_time,
        page=page,
        page_size=page_size,
    )


@router.get("/logs/stats", response_model=LogStatsResponse)
async def get_log_stats(
    agent_id: UUID | None = Query(default=None),
    from_time: datetime = Query(alias="from"),
    to_time: datetime = Query(alias="to"),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> LogStatsResponse:
    return await LogService.get_stats(
        session=session,
        user=user,
        agent_id=agent_id,
        from_time=from_time,
        to_time=to_time,
    )


@router.get("/logs/stream")
async def stream_logs(
    request: Request,
    token: str = Query(..., min_length=1),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    user = await get_user_from_access_token(token, session)
    if user.role not in {UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action.",
        )

    async def event_stream():
        channel = logs_channel(user.org_id)
        pubsub = await create_pubsub()
        last_keepalive = monotonic()
        try:
            await pubsub.subscribe(channel)
            while True:
                if await request.is_disconnected():
                    break

                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if message is None:
                    now = monotonic()
                    if now - last_keepalive >= 15:
                        last_keepalive = now
                        yield ": keepalive\n\n"
                    await asyncio.sleep(0.05)
                    continue

                raw_payload = message.get("data")
                if raw_payload is None:
                    continue
                if isinstance(raw_payload, bytes):
                    raw_payload = raw_payload.decode("utf-8")
                if not isinstance(raw_payload, str):
                    raw_payload = json.dumps(raw_payload, default=str)
                yield f"data: {raw_payload}\n\n"
        finally:
            with suppress(Exception):
                await pubsub.unsubscribe(channel)
            with suppress(Exception):
                await pubsub.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/correlate", response_model=CorrelationResponse)
async def correlate(
    agent_id: UUID = Query(...),
    from_time: datetime = Query(alias="from"),
    to_time: datetime = Query(alias="to"),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> CorrelationResponse:
    return await LogService.correlate(
        session=session,
        user=user,
        agent_id=agent_id,
        from_time=from_time,
        to_time=to_time,
    )


@router.get("/correlate/events", response_model=RecentCorrelationEventsResponse)
async def get_recent_correlation_events(
    limit: int = Query(default=20, ge=1, le=100),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> RecentCorrelationEventsResponse:
    events = await CorrelationEngine.get_recent(
        session=session,
        org_id=user.org_id,
        limit=limit,
    )
    return RecentCorrelationEventsResponse(events=events)
