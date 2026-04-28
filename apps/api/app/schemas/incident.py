import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.models import IncidentSeverity, IncidentStatus


class IncidentTimelineEvent(BaseModel):
    event_id: str
    timestamp: str
    type: str
    title: str
    detail: str
    metric_snapshot: dict[str, float] | None = None
    severity: IncidentSeverity


class IncidentRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    agent_id: uuid.UUID
    title: str
    status: IncidentStatus
    severity: IncidentSeverity
    started_at: datetime
    resolved_at: datetime | None
    timeline_events: list[IncidentTimelineEvent]
    trigger_type: str
    trigger_id: uuid.UUID | None
    summary: str | None
    created_at: datetime
    updated_at: datetime


class IncidentListResponse(BaseModel):
    incidents: list[IncidentRead]
    total: int
    limit: int
    offset: int


class IncidentCommentRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=4000)


class IncidentStatusUpdateRequest(BaseModel):
    status: IncidentStatus
    comment: str | None = Field(default=None, max_length=4000)


class ManualIncidentCreateRequest(BaseModel):
    agent_id: uuid.UUID
    title: str = Field(min_length=3, max_length=255)
    severity: IncidentSeverity
    comment: str = Field(min_length=1, max_length=4000)
