from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_role
from app.database import get_session
from app.models import (
    Agent,
    AnomalyEvent,
    ForecastAlert,
    Incident,
    IncidentSeverity,
    IncidentStatus,
    LogEntry,
    Metric,
    UserRole,
)
from app.redis_client import ai_query_rate_limit_key, get_redis
from app.schemas.auth import AIHealthScoreResponse, AIQueryRequest, AIQueryResponse, UserIdentity
from app.services.llm_explainer import llm_explainer

router = APIRouter(prefix="/ai")

ONLINE_WINDOW_SECONDS = 45
METRIC_WINDOW_MINUTES = 60
TREND_SAMPLE_SIZE = 10
TREND_STABLE_DELTA = 2.0


@router.post("/query", response_model=AIQueryResponse)
async def ai_query(
    payload: AIQueryRequest,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> AIQueryResponse:
    await _enforce_rate_limit(user_id=str(user.user_id))
    context_data = await _build_ai_context(session=session, org_id=user.org_id)
    answer = llm_explainer.answer_query(
        org_id=str(user.org_id),
        question=payload.question,
        context_data=context_data,
    )
    return AIQueryResponse(answer=answer)


@router.get("/health-score", response_model=AIHealthScoreResponse)
async def get_ai_health_score(
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> AIHealthScoreResponse:
    context_data = await _build_ai_context(session=session, org_id=user.org_id)
    health = context_data["system_health"]
    agents = context_data["agents"]
    return AIHealthScoreResponse(
        score=int(health["score"]),
        label=str(health["label"]),
        agents=len(agents),
        online=sum(1 for agent in agents if agent["status"] == "alive"),
        issues=[str(issue) for issue in health["issues"]],
    )


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


async def _build_ai_context(session: AsyncSession, org_id: Any) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    metric_window_start = now - timedelta(minutes=METRIC_WINDOW_MINUTES)
    recent_window_start = now - timedelta(hours=1)

    agents = (
        await session.scalars(
            select(Agent)
            .where(Agent.org_id == org_id)
            .order_by(Agent.hostname.asc())
        )
    ).all()
    agent_by_id = {str(agent.id): agent for agent in agents}

    metrics = (
        await session.scalars(
            select(Metric)
            .where(
                Metric.org_id == org_id,
                Metric.time >= metric_window_start,
            )
            .order_by(Metric.agent_id.asc(), Metric.time.asc())
        )
    ).all()
    metrics_by_agent: dict[str, list[Metric]] = defaultdict(list)
    for metric in metrics:
        metrics_by_agent[str(metric.agent_id)].append(metric)

    logs = (
        await session.scalars(
            select(LogEntry)
            .where(
                LogEntry.org_id == org_id,
                LogEntry.level.in_(["ERROR", "CRITICAL"]),
                LogEntry.time >= recent_window_start,
            )
            .order_by(desc(LogEntry.time))
            .limit(20)
        )
    ).all()

    anomalies = (
        await session.scalars(
            select(AnomalyEvent)
            .where(
                AnomalyEvent.org_id == org_id,
                AnomalyEvent.created_at >= recent_window_start,
            )
            .order_by(desc(AnomalyEvent.created_at))
            .limit(5)
        )
    ).all()

    forecasts = (
        await session.scalars(
            select(ForecastAlert)
            .where(
                ForecastAlert.org_id == org_id,
                ForecastAlert.exceed_in_hours.is_not(None),
            )
            .order_by(desc(ForecastAlert.created_at))
            .limit(10)
        )
    ).all()

    incidents = (
        await session.scalars(
            select(Incident)
            .where(
                Incident.org_id == org_id,
                Incident.status.in_([IncidentStatus.OPEN, IncidentStatus.INVESTIGATING]),
            )
            .order_by(desc(Incident.started_at))
            .limit(20)
        )
    ).all()

    agent_summaries = [
        _summarize_agent(agent=agent, metrics=metrics_by_agent.get(str(agent.id), []), now=now)
        for agent in agents
    ]
    anomaly_summaries = [
        _summarize_anomaly(anomaly=anomaly, agent=agent_by_id.get(str(anomaly.agent_id)))
        for anomaly in anomalies
    ]
    incident_summaries = [
        {
            "id": str(incident.id),
            "agent": _hostname(agent_by_id.get(str(incident.agent_id))),
            "title": incident.title,
            "severity": incident.severity.value,
            "status": incident.status.value,
            "started_at": incident.started_at.isoformat(),
        }
        for incident in incidents
    ]
    context = {
        "current_time": now.isoformat(),
        "metric_window": f"last {METRIC_WINDOW_MINUTES} minutes",
        "agents": agent_summaries,
        "logs": _summarize_logs(logs=logs, agent_by_id=agent_by_id),
        "anomalies": anomaly_summaries,
        "forecasts": [
            {
                "id": str(forecast.id),
                "agent": _hostname(agent_by_id.get(str(forecast.agent_id))),
                "metric": forecast.metric,
                "current_value": round(float(forecast.current_value), 2),
                "predicted_value": round(float(forecast.predicted_value), 2),
                "exceed_in_hours": None
                if forecast.exceed_in_hours is None
                else round(float(forecast.exceed_in_hours), 2),
                "created_at": forecast.created_at.isoformat(),
                "explanation": forecast.explanation,
            }
            for forecast in forecasts
        ],
        "incidents": incident_summaries,
    }
    context["system_health"] = _compute_health_score(
        agents=agent_summaries,
        anomalies=anomaly_summaries,
        incidents=incident_summaries,
    )
    return context


def _summarize_agent(agent: Agent, metrics: list[Metric], now: datetime) -> dict[str, Any]:
    status_value = "alive" if (now - agent.last_seen).total_seconds() <= ONLINE_WINDOW_SECONDS else "offline"
    return {
        "agent_id": str(agent.id),
        "hostname": agent.hostname,
        "os": agent.os,
        "arch": agent.arch,
        "status": status_value,
        "last_seen": agent.last_seen.isoformat(),
        "metrics": {
            "cpu_percent": _metric_stats(metrics, "cpu"),
            "memory_percent": _metric_stats(metrics, "memory"),
            "disk_percent": _metric_stats(metrics, "disk"),
            "net_bytes_in": _metric_stats(metrics, "net_in"),
            "net_bytes_out": _metric_stats(metrics, "net_out"),
        },
    }


def _metric_stats(metrics: list[Metric], attribute: str) -> dict[str, Any]:
    if not metrics:
        return {
            "current": None,
            "average_60m": None,
            "min_60m": None,
            "max_60m": None,
            "trend": "unknown",
            "peak_time": None,
        }

    values = [float(getattr(metric, attribute)) for metric in metrics]
    current = values[-1]
    peak_index = max(range(len(values)), key=values.__getitem__)
    return {
        "current": round(current, 2),
        "average_60m": round(mean(values), 2),
        "min_60m": round(min(values), 2),
        "max_60m": round(max(values), 2),
        "trend": _trend_direction(values),
        "peak_time": metrics[peak_index].time.isoformat(),
    }


def _trend_direction(values: list[float]) -> str:
    if len(values) < 2:
        return "stable"
    first_values = values[:TREND_SAMPLE_SIZE]
    last_values = values[-TREND_SAMPLE_SIZE:]
    delta = mean(last_values) - mean(first_values)
    if delta > TREND_STABLE_DELTA:
        return "rising"
    if delta < -TREND_STABLE_DELTA:
        return "falling"
    return "stable"


def _summarize_logs(logs: list[LogEntry], agent_by_id: dict[str, Agent]) -> dict[str, Any]:
    grouped: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    recent = []
    for log in logs:
        hostname = _hostname(agent_by_id.get(str(log.agent_id)))
        grouped[hostname][log.source] += 1
        recent.append(
            {
                "timestamp": log.time.isoformat(),
                "agent": hostname,
                "level": log.level,
                "source": log.source,
                "message": log.message,
            }
        )

    return {
        "count_last_hour": len(logs),
        "recent": recent,
        "grouped_by_agent_source": [
            {
                "agent": agent,
                "source": source,
                "count": count,
            }
            for agent, source_counts in grouped.items()
            for source, count in source_counts.items()
        ],
    }


def _summarize_anomaly(anomaly: AnomalyEvent, agent: Agent | None) -> dict[str, Any]:
    score = float(anomaly.score)
    return {
        "id": str(anomaly.id),
        "agent": _hostname(agent),
        "score": round(score, 3),
        "severity": _anomaly_severity(score),
        "reason": anomaly.reason,
        "timestamp": anomaly.created_at.isoformat(),
        "explanation": anomaly.explanation,
        "snapshot": anomaly.snapshot,
    }


def _compute_health_score(
    *,
    agents: list[dict[str, Any]],
    anomalies: list[dict[str, Any]],
    incidents: list[dict[str, Any]],
) -> dict[str, Any]:
    score = 100
    issues: list[str] = []

    offline_agents = [agent["hostname"] for agent in agents if agent["status"] == "offline"]
    if offline_agents:
        score -= 20
        issues.append(f"{len(offline_agents)} agent offline: {', '.join(offline_agents[:3])}")

    critical_anomalies = [anomaly for anomaly in anomalies if anomaly["severity"] == "critical"]
    high_anomalies = [anomaly for anomaly in anomalies if anomaly["severity"] == "high"]
    if critical_anomalies:
        score -= 10 * len(critical_anomalies)
        issues.append(f"{len(critical_anomalies)} critical anomaly event(s) in the last hour")
    if high_anomalies:
        score -= 5 * len(high_anomalies)
        issues.append(f"{len(high_anomalies)} high anomaly event(s) in the last hour")

    hot_metric_labels = []
    for agent in agents:
        for metric_name in ("cpu_percent", "memory_percent", "disk_percent"):
            average = agent["metrics"][metric_name]["average_60m"]
            if average is not None and average > 85:
                hot_metric_labels.append(
                    f"{agent['hostname']} {metric_name.replace('_percent', '')} avg {average}%"
                )
    if hot_metric_labels:
        score -= 15
        issues.append(f"60-minute metric average above 85%: {', '.join(hot_metric_labels[:3])}")

    critical_open_incidents = [
        incident for incident in incidents if incident["severity"] == IncidentSeverity.CRITICAL.value
    ]
    if critical_open_incidents:
        score -= 10
        issues.append(f"{len(critical_open_incidents)} open critical incident(s)")

    final_score = max(0, score)
    return {
        "score": final_score,
        "label": _health_label(final_score),
        "issues": issues,
    }


def _health_label(score: int) -> str:
    if score <= 40:
        return "Critical"
    if score <= 70:
        return "Degraded"
    if score <= 90:
        return "Fair"
    return "Healthy"


def _anomaly_severity(score: float) -> str:
    if score >= 0.8:
        return "critical"
    if score >= 0.6:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def _hostname(agent: Agent | None) -> str:
    return agent.hostname if agent is not None else "unknown-agent"
