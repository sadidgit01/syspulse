from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from opentelemetry import trace

from app.auth import JWTAuthMiddleware
from app.config import get_settings
from app.database import close_database, engine, initialize_database
from app.redis_client import close_redis, get_redis
from app.routers import api_router
from app.services.ws_manager import ws_manager
from app.telemetry import instrument_fastapi, instrument_sqlalchemy, setup_tracing

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_tracing()
    instrument_sqlalchemy(engine)
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
    instrument_fastapi(application)

    @application.middleware("http")
    async def add_trace_id_header(request: Request, call_next):
        response = await call_next(request)
        span_context = trace.get_current_span().get_span_context()
        if span_context.is_valid:
            response.headers["X-Trace-ID"] = f"{span_context.trace_id:032x}"
        return response

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
