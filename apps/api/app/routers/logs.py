from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_agent
from app.database import get_session
from app.models import Agent
from app.schemas.agent import AgentIdentity
from app.schemas.log import LogBatchIngestRequest
from app.schemas.metric import IngestAcceptedResponse
from app.services.log_service import LogService

router = APIRouter()


@router.post("/ingest/logs", response_model=IngestAcceptedResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_logs(
    payload: LogBatchIngestRequest,
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
    accepted = await LogService.ingest_logs(session=session, agent=agent, payload=payload)
    return IngestAcceptedResponse(accepted=accepted)
