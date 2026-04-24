from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import JWTAuthMiddleware
from app.config import get_settings
from app.database import close_database, initialize_database
from app.redis_client import close_redis, get_redis
from app.routers import api_router
from app.services.ws_manager import ws_manager

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await initialize_database()
    await get_redis()
    yield
    await ws_manager.shutdown()
    await close_redis()
    await close_database()


def create_app() -> FastAPI:
    application = FastAPI(
        title="SysPulse API",
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )
    application.add_middleware(JWTAuthMiddleware)
    if settings.allowed_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    application.include_router(api_router)
    return application


app = create_app()
