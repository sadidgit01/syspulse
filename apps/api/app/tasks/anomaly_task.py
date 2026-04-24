import asyncio
import uuid
from datetime import timedelta

from sqlalchemy import select

from app.services.anomaly_detector import anomaly_detector
from app.services.llm_explainer import llm_explainer
from app.database import async_session_factory
from app.models import Agent, AnomalyEvent, LogEntry, Metric
from app.redis_client import anomalies_channel, publish_json
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

    return explanation
