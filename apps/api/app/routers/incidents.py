import asyncio
import json
import uuid
from contextlib import suppress
from datetime import datetime, timezone
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_user_from_access_token, require_role
from app.database import get_session
from app.models import IncidentSeverity, IncidentStatus, IncidentTriggerType, UserRole
from app.redis_client import create_pubsub, incidents_channel
from app.schemas.auth import UserIdentity
from app.schemas.incident import (
    IncidentCommentRequest,
    IncidentListResponse,
    IncidentRead,
    IncidentStatusUpdateRequest,
    ManualIncidentCreateRequest,
)
from app.services.incident_service import IncidentService

router = APIRouter()


@router.get("/incidents/stream")
async def stream_incidents(
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
        channel = incidents_channel(user.org_id)
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


@router.get("/incidents", response_model=IncidentListResponse)
async def list_incidents(
    status_filter: IncidentStatus | None = Query(default=None, alias="status"),
    agent_id: UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> IncidentListResponse:
    return await IncidentService.get_incidents(
        session=session,
        org_id=user.org_id,
        status_filter=status_filter,
        agent_id=agent_id,
        limit=limit,
        offset=offset,
    )


@router.post("/incidents", response_model=IncidentRead, status_code=status.HTTP_201_CREATED)
async def create_manual_incident(
    payload: ManualIncidentCreateRequest,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> IncidentRead:
    return await IncidentService.create_incident(
        session=session,
        org_id=user.org_id,
        agent_id=payload.agent_id,
        trigger_type=IncidentTriggerType.MANUAL.value,
        trigger_id=None,
        severity=payload.severity,
        initial_event={
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": "comment",
            "title": "Manual incident created",
            "detail": payload.comment,
            "metric_snapshot": None,
            "severity": payload.severity.value,
        },
        title=payload.title,
    )


@router.get("/incidents/{incident_id}", response_model=IncidentRead)
async def get_incident(
    incident_id: UUID,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> IncidentRead:
    return await IncidentService.get_incident(
        session=session,
        incident_id=incident_id,
        org_id=user.org_id,
    )


@router.post("/incidents/{incident_id}/comment", response_model=IncidentRead)
async def comment_on_incident(
    incident_id: UUID,
    payload: IncidentCommentRequest,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> IncidentRead:
    return await IncidentService.append_event(
        session=session,
        incident_id=incident_id,
        org_id=user.org_id,
        event={
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": "comment",
            "title": f"Comment from {user.email}",
            "detail": payload.comment,
            "metric_snapshot": None,
            "severity": IncidentSeverity.LOW.value,
        },
    )


@router.post("/incidents/{incident_id}/resolve", response_model=IncidentRead)
async def resolve_incident(
    incident_id: UUID,
    payload: IncidentCommentRequest,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> IncidentRead:
    return await IncidentService.resolve_incident(
        session=session,
        incident_id=incident_id,
        org_id=user.org_id,
        resolution_comment=payload.comment,
    )


@router.post("/incidents/{incident_id}/status", response_model=IncidentRead)
async def update_incident_status(
    incident_id: UUID,
    payload: IncidentStatusUpdateRequest,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> IncidentRead:
    return await IncidentService.update_status(
        session=session,
        incident_id=incident_id,
        org_id=user.org_id,
        status_value=payload.status,
        comment=payload.comment,
    )
