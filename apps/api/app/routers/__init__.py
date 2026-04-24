from fastapi import APIRouter

from app.routers.health import router as health_router
from app.routers.metrics import router as metrics_router
from app.routers.ws import router as ws_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(metrics_router, tags=["metrics"])
api_router.include_router(ws_router, tags=["websocket"])

__all__ = ["api_router"]
