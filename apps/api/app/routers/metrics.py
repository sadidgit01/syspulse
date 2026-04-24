from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_agent, require_role
from app.database import get_session
from app.models import Agent, UserRole
from app.schemas.agent import AgentIdentity
from app.schemas.auth import UserIdentity
from app.schemas.metric import (
    IngestAcceptedResponse,
    MetricBatchIngestRequest,
    MetricPointResponse,
    MetricResolution,
)
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
