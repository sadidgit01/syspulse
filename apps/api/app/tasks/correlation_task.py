import asyncio
import uuid

from celery import Celery

from app.config import get_settings
from app.database import async_session_factory
from app.services.correlation_engine import CorrelationEngine

settings = get_settings()

celery_app = Celery(
    "syspulse",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "run-correlation-cycle-every-60-seconds": {
            "task": "syspulse.correlation.run_cycle",
            "schedule": 60.0,
        }
    },
)


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
    return len(events)
