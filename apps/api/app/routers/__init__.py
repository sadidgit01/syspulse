from fastapi import APIRouter

from app.routers.ai import router as ai_router
from app.routers.agents import router as agents_router
from app.routers.auth import router as auth_router
from app.routers.health import router as health_router
from app.routers.logs import router as logs_router
from app.routers.metrics import router as metrics_router
from app.routers.ws import router as ws_router

api_router = APIRouter()
api_router.include_router(ai_router, tags=["ai"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(agents_router, tags=["agents"])
api_router.include_router(health_router, tags=["health"])
api_router.include_router(logs_router, tags=["logs"])
api_router.include_router(metrics_router, tags=["metrics"])
api_router.include_router(ws_router, tags=["websocket"])

__all__ = ["api_router"]
