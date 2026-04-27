import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class AgentStatus(StrEnum):
    ALIVE = "alive"
    OFFLINE = "offline"


class AgentRegistrationRequest(BaseModel):
    hostname: str = Field(min_length=1, max_length=255)
    os: str = Field(min_length=1, max_length=64)
    arch: str = Field(min_length=1, max_length=64)
    org_token: str = Field(min_length=1, max_length=255)


class AgentRegistrationResponse(BaseModel):
    agent_id: uuid.UUID
    agent_token: str


class AgentCertBundleResponse(BaseModel):
    agent_cert_pem: str
    agent_key_pem: str
    ca_cert_pem: str
    expires_at: datetime
    fingerprint: str


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    hostname: str
    os: str
    arch: str
    last_seen: datetime
    created_at: datetime


class AgentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    hostname: str
    os: str
    arch: str
    last_seen: datetime
    status: AgentStatus


class AgentIdentity(BaseModel):
    agent_id: uuid.UUID
    org_id: uuid.UUID
