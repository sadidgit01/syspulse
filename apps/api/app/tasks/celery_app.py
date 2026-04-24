from celery import Celery

from app.config import get_settings

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
        },
        "run-anomaly-training-every-hour": {
            "task": "syspulse.anomaly.train_cycle",
            "schedule": 60.0 * 60.0,
        },
        "run-forecast-cycle-every-30-minutes": {
            "task": "syspulse.forecast.run_cycle",
            "schedule": 60.0 * 30.0,
        },
    },
)
