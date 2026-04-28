import asyncio
import uuid

from sqlalchemy import select

from app.database import async_session_factory
from app.models import Agent, ForecastAlert, IncidentSeverity, IncidentTriggerType
from app.services.forecaster import forecaster
from app.services.incident_service import IncidentService
from app.services.llm_explainer import llm_explainer
from app.redis_client import forecasts_channel, publish_json
from app.tasks.celery_app import celery_app


@celery_app.task(name="syspulse.forecast.run_cycle")
def run_forecast_cycle() -> int:
    return asyncio.run(_run_forecast_cycle())


async def _run_forecast_cycle() -> int:
    active_org_ids = await forecaster.get_active_org_ids(active_within_hours=24)
    total_alerts = 0
    for org_id in active_org_ids:
        alerts = await forecaster.check_all_agents(org_id)
        total_alerts += len(alerts)
        for alert in alerts:
            await _enrich_forecast_alert(alert.id)
    return total_alerts


async def _enrich_forecast_alert(alert_id) -> None:
    async with async_session_factory() as session:
        alert = await session.scalar(select(ForecastAlert).where(ForecastAlert.id == alert_id))
        if alert is None:
            return
        agent = await session.scalar(
            select(Agent).where(
                Agent.id == alert.agent_id,
                Agent.org_id == alert.org_id,
            )
        )
        hostname = agent.hostname if agent is not None else str(alert.agent_id)
        explanation = llm_explainer.explain_forecast(
            {
                "hostname": hostname,
                "metric": alert.metric,
                "current_value": alert.current_value,
                "exceed_in_hours": alert.exceed_in_hours,
            }
        )
        alert.explanation = explanation
        await session.commit()
        await publish_json(
            forecasts_channel(alert.org_id),
            {
                "agent_id": str(alert.agent_id),
                "org_id": str(alert.org_id),
                "metric": alert.metric,
                "exceed_in_hours": alert.exceed_in_hours,
                "predicted_value": alert.predicted_value,
                "explanation": explanation,
            },
        )

        incident = await IncidentService.get_open_incident_for_agent(
            session=session,
            org_id=alert.org_id,
            agent_id=alert.agent_id,
        )
        incident_event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": alert.created_at.isoformat(),
            "type": "forecast_warning",
            "title": f"{alert.metric} predicted to breach threshold",
            "detail": explanation or f"Predicted value {float(alert.predicted_value):.1f}",
            "metric_snapshot": None,
            "severity": _incident_severity_from_forecast(alert.exceed_in_hours).value,
        }
        if incident is None:
            created = await IncidentService.create_incident(
                session=session,
                org_id=alert.org_id,
                agent_id=alert.agent_id,
                trigger_type=IncidentTriggerType.FORECAST.value,
                trigger_id=alert.id,
                severity=_incident_severity_from_forecast(alert.exceed_in_hours),
                initial_event=incident_event,
            )
            incident_id = created.id
        else:
            updated = await IncidentService.append_event(
                session=session,
                incident_id=incident.id,
                org_id=alert.org_id,
                event=incident_event,
            )
            incident_id = updated.id

        await IncidentService.auto_build_timeline(
            session=session,
            incident_id=incident_id,
            org_id=alert.org_id,
            agent_id=alert.agent_id,
        )


def _incident_severity_from_forecast(exceed_in_hours: float | None) -> IncidentSeverity:
    if exceed_in_hours is None:
        return IncidentSeverity.LOW
    if exceed_in_hours < 2:
        return IncidentSeverity.CRITICAL
    if exceed_in_hours < 6:
        return IncidentSeverity.HIGH
    if exceed_in_hours < 24:
        return IncidentSeverity.MEDIUM
    return IncidentSeverity.LOW
