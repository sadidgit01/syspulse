import asyncio

from sqlalchemy import select

from app.database import async_session_factory
from app.models import Agent, ForecastAlert
from app.services.forecaster import forecaster
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
