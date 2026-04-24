import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MetricIngest(BaseModel):
    org_id: uuid.UUID
    agent_id: uuid.UUID
    time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cpu: float = Field(ge=0, le=100)
    memory: float = Field(ge=0, le=100)
    disk: float = Field(ge=0, le=100)
    net_in: float = Field(ge=0)
    net_out: float = Field(ge=0)

    @field_validator("time")
    @classmethod
    def ensure_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class MetricRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    org_id: uuid.UUID
    agent_id: uuid.UUID
    time: datetime
    cpu: float
    memory: float
    disk: float
    net_in: float
    net_out: float
