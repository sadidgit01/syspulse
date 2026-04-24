from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.database import check_database_health
from app.redis_client import ping_redis

router = APIRouter()


@router.get("/health")
async def healthcheck() -> JSONResponse | dict[str, str]:
    db_ok = await check_database_health()
    redis_ok = await ping_redis()

    if db_ok and redis_ok:
        return {"status": "ok", "db": "ok", "redis": "ok"}

    return JSONResponse(
        status_code=503,
        content={
            "status": "degraded",
            "db": "ok" if db_ok else "error",
            "redis": "ok" if redis_ok else "error",
        },
    )
