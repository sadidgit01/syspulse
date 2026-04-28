from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_agent_token
from app.models import Agent, Organization
from app.schemas.agent import (
    AgentListItem,
    AgentRegistrationRequest,
    AgentRegistrationResponse,
    AgentStatus,
)


class AgentService:
    @staticmethod
    async def register_agent(
        session: AsyncSession,
        payload: AgentRegistrationRequest,
    ) -> AgentRegistrationResponse:
        organization = await session.scalar(
            select(Organization).where(Organization.org_token == payload.org_token)
        )
        if organization is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid organization token.",
            )

        agent = Agent(
            org_id=organization.org_id,
            hostname=payload.hostname,
            os=payload.os,
            arch=payload.arch,
        )
        session.add(agent)
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An agent with this hostname already exists in the organization.",
            ) from exc
        await session.refresh(agent)

        return AgentRegistrationResponse(
            agent_id=agent.id,
            agent_token=create_agent_token(agent.id, agent.org_id),
        )

    @staticmethod
    async def list_agents(session: AsyncSession, org_id: UUID) -> list[AgentListItem]:
        result = await session.scalars(
            select(Agent)
            .where(Agent.org_id == org_id)
            .order_by(Agent.hostname.asc())
        )
        # The development agent ships 30-second batches, so a small grace window
        # prevents false offline flapping from scheduler or network jitter.
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=45)
        return [
            AgentListItem(
                id=agent.id,
                org_id=agent.org_id,
                hostname=agent.hostname,
                os=agent.os,
                arch=agent.arch,
                last_seen=agent.last_seen,
                status=AgentStatus.ALIVE if agent.last_seen >= cutoff else AgentStatus.OFFLINE,
            )
            for agent in result.all()
        ]
