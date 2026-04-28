import asyncio

from app.services.alert_evaluator import alert_evaluator
from app.tasks.celery_app import celery_app


@celery_app.task(name="syspulse.alert.run_cycle")
def run_alert_cycle() -> int:
    return asyncio.run(_run_alert_cycle())


async def _run_alert_cycle() -> int:
    active_org_ids = await alert_evaluator.get_active_org_ids(active_within_minutes=5)
    fired_total = 0
    for org_id in active_org_ids:
        fired_total += await alert_evaluator.evaluate_all(org_id)
    return fired_total
