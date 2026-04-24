from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_session
from app.schemas.agent import (
    AgentListItem,
    AgentRegistrationRequest,
    AgentRegistrationResponse,
)
from app.schemas.auth import UserIdentity
from app.services.agent_service import AgentService

router = APIRouter()


@router.post(
    "/agents/register",
    response_model=AgentRegistrationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_agent(
    payload: AgentRegistrationRequest,
    session: AsyncSession = Depends(get_session),
) -> AgentRegistrationResponse:
    return await AgentService.register_agent(session=session, payload=payload)


@router.get("/agents", response_model=list[AgentListItem])
async def list_agents(
    user: UserIdentity = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AgentListItem]:
    return await AgentService.list_agents(session=session, org_id=user.org_id)
