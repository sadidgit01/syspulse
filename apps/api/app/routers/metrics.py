import asyncio
import json
from contextlib import suppress
from datetime import datetime
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_agent, get_user_from_access_token, require_role
from app.database import get_session
from app.models import Agent, UserRole
from app.redis_client import anomalies_channel, create_pubsub
from app.schemas.agent import AgentIdentity
from app.schemas.anomaly import AnomalyEventRead
from app.schemas.auth import UserIdentity
from app.schemas.forecast import ForecastAlertRead, ForecastMetric
from app.schemas.metric import (
    IngestAcceptedResponse,
    MetricBatchIngestRequest,
    MetricPointResponse,
    MetricResolution,
)
from app.services.anomaly_detector import anomaly_detector
from app.services.forecaster import forecaster
from app.services.metric_service import MetricService

router = APIRouter()


@router.post("/ingest/metrics", response_model=IngestAcceptedResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_metrics(
    payload: MetricBatchIngestRequest,
    identity: AgentIdentity = Depends(get_current_agent),
    session: AsyncSession = Depends(get_session),
) -> IngestAcceptedResponse:
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
    accepted = await MetricService.ingest_metrics(session=session, agent=agent, payload=payload)
    return IngestAcceptedResponse(accepted=accepted)


@router.get("/metrics/{agent_id}", response_model=list[MetricPointResponse])
async def get_metrics(
    agent_id: UUID,
    from_time: datetime | None = Query(default=None, alias="from"),
    to_time: datetime | None = Query(default=None, alias="to"),
    resolution: MetricResolution = Query(default=MetricResolution.RAW),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> list[MetricPointResponse]:
    return await MetricService.list_metrics(
        session=session,
        user=user,
        agent_id=agent_id,
        from_time=from_time,
        to_time=to_time,
        resolution=resolution,
    )


@router.get("/anomalies", response_model=list[AnomalyEventRead])
async def get_anomalies(
    agent_id: UUID | None = Query(default=None),
    from_time: datetime | None = Query(default=None, alias="from"),
    to_time: datetime | None = Query(default=None, alias="to"),
    min_score: float = Query(default=0.5, ge=0.0, le=1.0),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
    ) -> list[AnomalyEventRead]:
    return await anomaly_detector.list_events(
        session=session,
        org_id=user.org_id,
        agent_id=agent_id,
        from_time=from_time,
        to_time=to_time,
        min_score=min_score,
    )


@router.get("/anomalies/stream")
async def stream_anomalies(
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
        channel = anomalies_channel(user.org_id)
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


@router.get("/forecasts", response_model=list[ForecastAlertRead])
async def get_forecasts(
    agent_id: UUID | None = Query(default=None),
    metric: ForecastMetric | None = Query(default=None),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> list[ForecastAlertRead]:
    return await forecaster.get_latest_alerts(
        session=session,
        org_id=user.org_id,
        agent_id=agent_id,
        metric=metric,
    )
