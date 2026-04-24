from fastapi import HTTPException, status
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, LogEntry
from app.schemas.log import LogBatchIngestRequest


class LogService:
    @staticmethod
    async def ingest_logs(
        session: AsyncSession,
        agent: Agent,
        payload: LogBatchIngestRequest,
    ) -> int:
        entries = [
            {
                "time": item.timestamp,
                "agent_id": agent.id,
                "org_id": agent.org_id,
                "level": item.level.value,
                "source": item.source,
                "message": item.message,
            }
            for item in payload.root
        ]
        try:
            await session.execute(insert(LogEntry), entries)
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="One or more log entries conflict with existing records.",
            ) from exc
        return len(entries)
