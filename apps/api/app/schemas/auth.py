import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class TokenType(StrEnum):
    USER = "user"
    AGENT = "agent"


class TokenClaims(BaseModel):
    sub: uuid.UUID
    org_id: uuid.UUID
    token_type: TokenType
    exp: datetime
    role: str | None = None


class UserIdentity(BaseModel):
    user_id: uuid.UUID
    org_id: uuid.UUID
    role: str | None = None
