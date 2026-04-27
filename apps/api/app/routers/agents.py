from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_agent, require_role
from app.database import get_session
from app.models import Agent, UserRole
from app.schemas.agent import (
    AgentCertBundleResponse,
    AgentIdentity,
    AgentListItem,
    AgentRegistrationRequest,
    AgentRegistrationResponse,
)
from app.schemas.auth import UserIdentity
from app.services.agent_service import AgentService
from app.services.cert_manager import CertManager

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
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> list[AgentListItem]:
    return await AgentService.list_agents(session=session, org_id=user.org_id)


@router.get("/agents/{agent_id}/cert", response_model=AgentCertBundleResponse)
async def get_agent_cert(
    agent_id: UUID,
    identity: AgentIdentity = Depends(get_current_agent),
    session: AsyncSession = Depends(get_session),
) -> AgentCertBundleResponse:
    agent = await _authorize_agent_cert_request(agent_id, identity, session)
    bundle = await CertManager(session).get_or_issue_agent_cert(
        org_id=agent.org_id,
        agent_id=agent.id,
        hostname=agent.hostname,
    )
    await session.commit()
    return AgentCertBundleResponse(**bundle.__dict__)


@router.post("/agents/{agent_id}/rotate-cert", response_model=AgentCertBundleResponse)
async def rotate_agent_cert(
    agent_id: UUID,
    identity: AgentIdentity = Depends(get_current_agent),
    session: AsyncSession = Depends(get_session),
) -> AgentCertBundleResponse:
    agent = await _authorize_agent_cert_request(agent_id, identity, session)
    bundle = await CertManager(session).issue_agent_cert(
        org_id=agent.org_id,
        agent_id=agent.id,
        hostname=agent.hostname,
    )
    await session.commit()
    return AgentCertBundleResponse(**bundle.__dict__)


async def _authorize_agent_cert_request(
    agent_id: UUID,
    identity: AgentIdentity,
    session: AsyncSession,
) -> Agent:
    if agent_id != identity.agent_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent certificates can only be requested by the owning agent.",
        )
    agent = await session.scalar(
        select(Agent).where(Agent.id == identity.agent_id, Agent.org_id == identity.org_id)
    )
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Agent token is no longer valid.",
        )
    return agent
