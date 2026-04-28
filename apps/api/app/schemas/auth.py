import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, EmailStr, Field

from app.models.user import UserRole


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"
    AGENT = "agent"
    INVITE = "invite"


class TokenClaims(BaseModel):
    sub: str
    org_id: uuid.UUID | None = None
    token_type: TokenType
    exp: datetime
    iat: datetime | None = None
    role: UserRole | None = None
    email: EmailStr | None = None
    jti: str | None = None


class UserIdentity(BaseModel):
    user_id: uuid.UUID
    org_id: uuid.UUID
    role: UserRole
    email: EmailStr


class OrganizationRead(BaseModel):
    org_id: uuid.UUID
    name: str
    slug: str
    org_token: str


class UserRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole
    created_at: datetime


class AuthTokens(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    org_name: str = Field(min_length=2, max_length=255)


class RegisterResponse(AuthTokens):
    user_id: uuid.UUID
    org_id: uuid.UUID
    org_token: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginResponse(AuthTokens):
    user: UserRead


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class RefreshResponse(AuthTokens):
    pass


class MeResponse(BaseModel):
    user: UserRead
    organization: OrganizationRead
    role: UserRole


class InviteRequest(BaseModel):
    email: EmailStr
    role: UserRole


class InviteResponse(BaseModel):
    invite_link: str
    invite_token: str


class AcceptInviteRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class AIQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class AIQueryResponse(BaseModel):
    answer: str


class AIHealthScoreResponse(BaseModel):
    score: int
    label: str
    agents: int
    online: int
    issues: list[str]
