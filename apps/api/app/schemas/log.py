import uuid
from typing import Any

from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field, RootModel, field_validator, model_validator


class LogLevel(StrEnum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class LogEntryIn(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    level: LogLevel
    source: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1)

    @field_validator("timestamp")
    @classmethod
    def ensure_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class LogBatchIngestRequest(RootModel[list[LogEntryIn]]):
    root: list[LogEntryIn]

    @model_validator(mode="after")
    def validate_batch_size(self) -> "LogBatchIngestRequest":
        if not self.root:
            raise ValueError("At least one log entry is required.")
        return self


class LogEntryRead(BaseModel):
    id: uuid.UUID
    time: datetime
    agent_id: uuid.UUID
    org_id: uuid.UUID
    level: LogLevel
    source: str
    message: str


class LogsQueryResponse(BaseModel):
    logs: list[LogEntryRead]
    total: int
    page: int
    pages: int


class LogLevelCount(BaseModel):
    level: LogLevel
    count: int


class LogSourceCount(BaseModel):
    source: str
    count: int


class LogErrorRatePoint(BaseModel):
    timestamp: datetime
    total_logs: int
    error_logs: int
    error_rate: float


class LogStatsResponse(BaseModel):
    levels: list[LogLevelCount]
    sources: list[LogSourceCount]
    error_rate_over_time: list[LogErrorRatePoint]


class CorrelationEvent(BaseModel):
    type: str
    timestamp: datetime
    data: dict[str, Any]


class CorrelationResponse(BaseModel):
    events: list[CorrelationEvent]
