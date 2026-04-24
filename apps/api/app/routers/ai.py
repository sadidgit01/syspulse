from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_role
from app.database import get_session
from app.models import Agent, UserRole
from app.redis_client import ai_query_rate_limit_key, get_redis
from app.schemas.auth import AIQueryRequest, AIQueryResponse, UserIdentity
from app.services.anomaly_detector import anomaly_detector
from app.services.forecaster import forecaster
from app.services.llm_explainer import llm_explainer

router = APIRouter(prefix="/ai")


@router.post("/query", response_model=AIQueryResponse)
async def ai_query(
    payload: AIQueryRequest,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> AIQueryResponse:
    await _enforce_rate_limit(user_id=str(user.user_id))

    window_start = datetime.now(timezone.utc) - timedelta(minutes=30)
    anomalies = await anomaly_detector.list_events(
        session=session,
        org_id=user.org_id,
        agent_id=None,
        from_time=window_start,
        to_time=None,
        min_score=0.0,
    )
    forecasts = [
        alert
        for alert in await forecaster.get_latest_alerts(
            session=session,
            org_id=user.org_id,
            agent_id=None,
            metric=None,
        )
        if alert.created_at >= window_start
    ]
    agents = (
        await session.scalars(
            select(Agent)
            .where(Agent.org_id == user.org_id)
            .order_by(Agent.hostname.asc())
        )
    ).all()
    context_data = {
        "recent_anomalies": [event.model_dump(mode="json") for event in anomalies[:10]],
        "recent_forecasts": [alert.model_dump(mode="json") for alert in forecasts[:10]],
        "agent_statuses": [
            {
                "agent_id": str(agent.id),
                "hostname": agent.hostname,
                "last_seen": agent.last_seen.isoformat(),
                "status": "alive"
                if (datetime.now(timezone.utc) - agent.last_seen).total_seconds() < 30
                else "offline",
            }
            for agent in agents[:25]
        ],
    }
    answer = llm_explainer.answer_query(
        org_id=str(user.org_id),
        question=payload.question,
        context_data=context_data,
    )
    return AIQueryResponse(answer=answer)


async def _enforce_rate_limit(user_id: str) -> None:
    client = await get_redis()
    key = ai_query_rate_limit_key(user_id)
    count = await client.incr(key)
    if count == 1:
        await client.expire(key, 60)
    if count > 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="AI query rate limit exceeded. Try again in a minute.",
        )
