from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.metric import MetricIngest, MetricRead
from app.services.metric_service import MetricService

router = APIRouter()


@router.post("/ingest/metrics", response_model=MetricRead, status_code=status.HTTP_201_CREATED)
async def ingest_metrics(
    payload: MetricIngest,
    session: AsyncSession = Depends(get_session),
) -> MetricRead:
    return await MetricService.ingest_metric(session=session, payload=payload)


@router.get("/metrics/{agent_id}", response_model=list[MetricRead])
async def get_metrics(
    agent_id: UUID,
    org_id: UUID = Query(...),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    session: AsyncSession = Depends(get_session),
) -> list[MetricRead]:
    return await MetricService.list_metrics(
        session=session,
        org_id=org_id,
        agent_id=agent_id,
        start_time=start,
        end_time=end,
        limit=limit,
    )
