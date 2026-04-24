import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AgentRegistration(BaseModel):
    org_id: uuid.UUID
    hostname: str = Field(min_length=1, max_length=255)


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    hostname: str
    last_seen: datetime
    created_at: datetime
