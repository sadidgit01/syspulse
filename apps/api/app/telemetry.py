from __future__ import annotations

import logging
from typing import Set

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_tracing_initialized = False
_sqlalchemy_instrumented = False
_fastapi_instrumented_apps: Set[int] = set()


def setup_tracing():
    global _tracing_initialized

    if not settings.otel_enabled:
        return trace.get_tracer("syspulse-api")

    if _tracing_initialized:
        return trace.get_tracer("syspulse-api")

    resource = Resource.create({"service.name": "syspulse-api"})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _tracing_initialized = True
    logger.info(
        "OpenTelemetry tracing enabled with OTLP endpoint %s",
        settings.otel_exporter_otlp_endpoint,
    )
    return trace.get_tracer("syspulse-api")


def instrument_fastapi(application: FastAPI) -> None:
    if not settings.otel_enabled:
        return

    app_id = id(application)
    if app_id in _fastapi_instrumented_apps:
        return

    FastAPIInstrumentor.instrument_app(application)
    _fastapi_instrumented_apps.add(app_id)


def instrument_sqlalchemy(engine: AsyncEngine) -> None:
    global _sqlalchemy_instrumented

    if not settings.otel_enabled or _sqlalchemy_instrumented:
        return

    SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
    _sqlalchemy_instrumented = True
