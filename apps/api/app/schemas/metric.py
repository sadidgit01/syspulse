from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field, RootModel, field_validator, model_validator


class MetricResolution(StrEnum):
    RAW = "raw"
    ONE_MINUTE = "1m"
    FIVE_MINUTES = "5m"
    ONE_HOUR = "1h"


class MetricSnapshotIn(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cpu_percent: float = Field(ge=0, le=100)
    memory_percent: float = Field(ge=0, le=100)
    disk_percent: float = Field(ge=0, le=100)
    net_bytes_in: float = Field(ge=0)
    net_bytes_out: float = Field(ge=0)

    @field_validator("timestamp")
    @classmethod
    def ensure_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class MetricBatchIngestRequest(RootModel[list[MetricSnapshotIn]]):
    root: list[MetricSnapshotIn]

    @model_validator(mode="after")
    def validate_batch_size(self) -> "MetricBatchIngestRequest":
        count = len(self.root)
        if count == 0:
            raise ValueError("At least one metric snapshot is required.")
        if count > 100:
            raise ValueError("A maximum of 100 metric snapshots may be submitted at once.")
        return self


class MetricPointResponse(BaseModel):
    timestamp: datetime
    cpu_percent: float
    memory_percent: float
    disk_percent: float
    net_bytes_in: float
    net_bytes_out: float


class IngestAcceptedResponse(BaseModel):
    accepted: int
