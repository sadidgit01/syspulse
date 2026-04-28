import asyncio
import uuid
from datetime import timedelta

from sqlalchemy import select

from app.services.anomaly_detector import anomaly_detector
from app.services.llm_explainer import llm_explainer
from app.database import async_session_factory
from app.models import Agent, AnomalyEvent, IncidentSeverity, IncidentTriggerType, LogEntry, Metric
from app.redis_client import anomalies_channel, publish_json
from app.services.incident_service import IncidentService
from app.tasks.celery_app import celery_app


@celery_app.task(name="syspulse.anomaly.train_cycle")
def run_anomaly_training_cycle() -> int:
    return asyncio.run(_run_anomaly_training_cycle())


@celery_app.task(name="syspulse.anomaly.train_agent")
def train_agent_anomaly_model(agent_id: str, org_id: str) -> bool:
    return asyncio.run(
        anomaly_detector.train(
            agent_id=uuid.UUID(agent_id),
            org_id=uuid.UUID(org_id),
        )
    )


@celery_app.task(name="syspulse.anomaly.enrich_event")
def enrich_anomaly_explanation(event_id: str) -> str:
    return asyncio.run(_enrich_anomaly_explanation(uuid.UUID(event_id)))


async def _run_anomaly_training_cycle() -> int:
    active_agents = await anomaly_detector.get_agents_with_recent_data(active_within_hours=25)
    for agent_id, org_id in active_agents:
        train_agent_anomaly_model.delay(str(agent_id), str(org_id))
    return len(active_agents)


async def _enrich_anomaly_explanation(event_id: uuid.UUID) -> str:
    async with async_session_factory() as session:
        event = await session.scalar(select(AnomalyEvent).where(AnomalyEvent.id == event_id))
        if event is None:
            return "missing_event"

        agent = await session.scalar(
            select(Agent).where(
                Agent.id == event.agent_id,
                Agent.org_id == event.org_id,
            )
        )
        if agent is None:
            return "missing_agent"

        reference_time = event.created_at
        window_start = reference_time - timedelta(minutes=5)
        recent_metrics = (
            await session.execute(
                select(Metric)
                .where(
                    Metric.org_id == event.org_id,
                    Metric.agent_id == event.agent_id,
                    Metric.time >= window_start,
                    Metric.time <= reference_time,
                )
                .order_by(Metric.time.asc())
            )
        ).scalars().all()
        recent_logs = (
            await session.execute(
                select(LogEntry)
                .where(
                    LogEntry.org_id == event.org_id,
                    LogEntry.agent_id == event.agent_id,
                    LogEntry.level.in_(["ERROR", "CRITICAL"]),
                    LogEntry.time >= window_start,
                    LogEntry.time <= reference_time,
                )
                .order_by(LogEntry.time.desc())
                .limit(20)
            )
        ).scalars().all()

        explanation = llm_explainer.explain_anomaly(
            anomaly_event={
                "hostname": agent.hostname,
                "time": reference_time.isoformat(),
                "reason": event.reason,
                "score": event.score,
            },
            recent_metrics=[
                {
                    "cpu_percent": metric.cpu,
                    "memory_percent": metric.memory,
                    "disk_percent": metric.disk,
                    "net_bytes_in": metric.net_in,
                    "net_bytes_out": metric.net_out,
                }
                for metric in recent_metrics
            ],
            recent_logs=[
                {
                    "message": log_entry.message,
                    "level": log_entry.level,
                    "source": log_entry.source,
                }
                for log_entry in recent_logs
            ],
        )
        event.explanation = explanation
        await session.commit()

        await publish_json(
            anomalies_channel(event.org_id),
            {
                "event_id": str(event.id),
                "agent_id": str(event.agent_id),
                "org_id": str(event.org_id),
                "timestamp": event.created_at.isoformat(),
                "anomaly": {
                    "score": float(event.score),
                    "reason": event.reason,
                    "details": event.details or {},
                    "is_anomaly": True,
                },
                "snapshot": event.snapshot or {},
                "explanation": explanation,
            },
        )

        incident = await IncidentService.get_open_incident_for_agent(
            session=session,
            org_id=event.org_id,
            agent_id=event.agent_id,
        )
        incident_event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": event.created_at.isoformat(),
            "type": "anomaly",
            "title": f"Anomaly detected: {event.reason}",
            "detail": explanation or f"Anomaly score {float(event.score):.2f}",
            "metric_snapshot": {
                "cpu": float((event.snapshot or {}).get("cpu_percent", 0.0)),
                "memory": float((event.snapshot or {}).get("memory_percent", 0.0)),
                "disk": float((event.snapshot or {}).get("disk_percent", 0.0)),
            },
            "severity": _incident_severity_from_score(float(event.score)).value,
        }
        if incident is None:
            created = await IncidentService.create_incident(
                session=session,
                org_id=event.org_id,
                agent_id=event.agent_id,
                trigger_type=IncidentTriggerType.ANOMALY.value,
                trigger_id=event.id,
                severity=_incident_severity_from_score(float(event.score)),
                initial_event=incident_event,
            )
            incident_id = created.id
        else:
            updated = await IncidentService.append_event(
                session=session,
                incident_id=incident.id,
                org_id=event.org_id,
                event=incident_event,
            )
            incident_id = updated.id

        await IncidentService.auto_build_timeline(
            session=session,
            incident_id=incident_id,
            org_id=event.org_id,
            agent_id=event.agent_id,
        )

    return explanation


def _incident_severity_from_score(score: float) -> IncidentSeverity:
    if score > 0.8:
        return IncidentSeverity.CRITICAL
    if score > 0.6:
        return IncidentSeverity.HIGH
    if score > 0.4:
        return IncidentSeverity.MEDIUM
    return IncidentSeverity.LOW
