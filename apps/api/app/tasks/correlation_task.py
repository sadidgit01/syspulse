import asyncio
import uuid

from app.database import async_session_factory
from app.models import IncidentSeverity, IncidentTriggerType
from app.services.incident_service import IncidentService
from app.services.correlation_engine import CorrelationEngine
from app.tasks.celery_app import celery_app


@celery_app.task(name="syspulse.correlation.run_cycle")
def run_correlation_cycle() -> int:
    return asyncio.run(_run_correlation_cycle())


@celery_app.task(name="syspulse.correlation.analyze_org")
def analyze_org_correlation(org_id: str, window_minutes: int = 10) -> int:
    return asyncio.run(_analyze_org_correlation(org_id=uuid.UUID(org_id), window_minutes=window_minutes))


async def _run_correlation_cycle() -> int:
    async with async_session_factory() as session:
        active_org_ids = await CorrelationEngine.get_active_org_ids(
            session=session,
            active_within_minutes=5,
        )

    for org_id in active_org_ids:
        analyze_org_correlation.delay(str(org_id))

    return len(active_org_ids)


async def _analyze_org_correlation(org_id: uuid.UUID, window_minutes: int) -> int:
    async with async_session_factory() as session:
        events = await CorrelationEngine.analyze(
            session=session,
            org_id=org_id,
            window_minutes=window_minutes,
        )
        for event in events:
            incident = await IncidentService.get_open_incident_for_agent(
                session=session,
                org_id=org_id,
                agent_id=event.agent_id,
            )
            incident_event = {
                "event_id": str(uuid.uuid4()),
                "timestamp": event.created_at.isoformat(),
                "type": "correlation",
                "title": f"{event.spike_metric.value.upper()} spike correlated with errors",
                "detail": f"Correlation score {float(event.correlation_score):.2f}",
                "metric_snapshot": None,
                "severity": IncidentSeverity.HIGH.value,
            }
            if incident is None:
                created = await IncidentService.create_incident(
                    session=session,
                    org_id=org_id,
                    agent_id=event.agent_id,
                    trigger_type=IncidentTriggerType.CORRELATION.value,
                    trigger_id=event.id,
                    severity=IncidentSeverity.HIGH,
                    initial_event=incident_event,
                )
                incident_id = created.id
            else:
                updated = await IncidentService.append_event(
                    session=session,
                    incident_id=incident.id,
                    org_id=org_id,
                    event=incident_event,
                )
                incident_id = updated.id

            await IncidentService.auto_build_timeline(
                session=session,
                incident_id=incident_id,
                org_id=org_id,
                agent_id=event.agent_id,
            )
    return len(events)
