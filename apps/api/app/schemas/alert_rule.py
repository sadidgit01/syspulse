import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.models import AlertRuleConditionType, IncidentSeverity


class AlertRuleChannel(BaseModel):
    type: str = Field(min_length=1, max_length=32)
    webhook_url: str | None = None
    address: str | None = None
    url: str | None = None
    method: str | None = None


class AlertRuleBase(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    is_enabled: bool = True
    condition_type: AlertRuleConditionType
    condition_json: dict[str, Any]
    severity: IncidentSeverity
    channels_json: list[dict[str, Any]] = Field(default_factory=list)
    cooldown_minutes: int = Field(default=30, ge=0, le=10_080)


class AlertRuleCreate(AlertRuleBase):
    pass


class AlertRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    is_enabled: bool | None = None
    condition_type: AlertRuleConditionType | None = None
    condition_json: dict[str, Any] | None = None
    severity: IncidentSeverity | None = None
    channels_json: list[dict[str, Any]] | None = None
    cooldown_minutes: int | None = Field(default=None, ge=0, le=10_080)


class AlertRuleRead(AlertRuleBase):
    id: uuid.UUID
    org_id: uuid.UUID
    last_fired_at: datetime | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AlertRuleTestResponse(BaseModel):
    would_fire: bool
    matching_agents: list[uuid.UUID]
    reason: str
