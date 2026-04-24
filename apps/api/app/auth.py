from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import get_settings
from app.database import get_session
from app.models import Agent, User, UserRole
from app.redis_client import is_refresh_token_used
from app.schemas.agent import AgentIdentity
from app.schemas.auth import TokenClaims, TokenType, UserIdentity

settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=7)
AGENT_TOKEN_TTL = timedelta(days=30)
INVITE_TOKEN_TTL = timedelta(hours=48)


def _build_payload(
    *,
    subject: str,
    token_type: TokenType,
    org_id: uuid.UUID | None = None,
    role: UserRole | None = None,
    email: str | None = None,
    ttl: timedelta,
    include_jti: bool = False,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "token_type": token_type.value,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    if org_id is not None:
        payload["org_id"] = str(org_id)
    if role is not None:
        payload["role"] = role.value
    if email is not None:
        payload["email"] = email
    if include_jti:
        payload["jti"] = str(uuid.uuid4())
    return payload


def create_access_token(user_id: uuid.UUID, org_id: uuid.UUID, role: UserRole) -> str:
    payload = _build_payload(
        subject=str(user_id),
        token_type=TokenType.ACCESS,
        org_id=org_id,
        role=role,
        ttl=ACCESS_TOKEN_TTL,
    )
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: uuid.UUID, org_id: uuid.UUID, role: UserRole) -> str:
    payload = _build_payload(
        subject=str(user_id),
        token_type=TokenType.REFRESH,
        org_id=org_id,
        role=role,
        ttl=REFRESH_TOKEN_TTL,
        include_jti=True,
    )
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def create_agent_token(agent_id: uuid.UUID, org_id: uuid.UUID) -> str:
    payload = _build_payload(
        subject=str(agent_id),
        token_type=TokenType.AGENT,
        org_id=org_id,
        ttl=AGENT_TOKEN_TTL,
    )
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def create_invite_token(org_id: uuid.UUID, email: str, role: UserRole) -> str:
    payload = _build_payload(
        subject=email,
        token_type=TokenType.INVITE,
        org_id=org_id,
        role=role,
        email=email,
        ttl=INVITE_TOKEN_TTL,
    )
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> TokenClaims:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        ) from exc

    try:
        return TokenClaims.model_validate(payload)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication claims.",
        ) from exc


class JWTAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.auth_claims = None
        auth_header = request.headers.get("Authorization", "").strip()
        if auth_header:
            scheme, _, token = auth_header.partition(" ")
            if scheme.lower() != "bearer" or not token:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Authorization header must use Bearer token format."},
                )
            request.state.auth_claims = decode_token(token)
        return await call_next(request)


async def _get_token_claims(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> TokenClaims:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
        )
    claims = getattr(request.state, "auth_claims", None)
    if claims is None:
        claims = decode_token(credentials.credentials)
        request.state.auth_claims = claims
    return claims


async def get_current_agent(
    claims: TokenClaims = Depends(_get_token_claims),
    session: AsyncSession = Depends(get_session),
) -> AgentIdentity:
    if claims.token_type != TokenType.AGENT or claims.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent token required.",
        )

    agent_id = _parse_uuid(claims.sub)
    agent = await session.scalar(
        select(Agent).where(
            Agent.id == agent_id,
            Agent.org_id == claims.org_id,
        )
    )
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Agent token is no longer valid.",
        )
    return AgentIdentity(agent_id=agent.id, org_id=agent.org_id)


async def get_current_user(
    claims: TokenClaims = Depends(_get_token_claims),
    session: AsyncSession = Depends(get_session),
) -> UserIdentity:
    return await get_user_from_access_claims(claims, session)


async def get_user_from_access_token(token: str, session: AsyncSession) -> UserIdentity:
    claims = decode_token(token)
    return await get_user_from_access_claims(claims, session)


async def get_user_from_access_claims(
    claims: TokenClaims,
    session: AsyncSession,
) -> UserIdentity:
    if claims.token_type != TokenType.ACCESS or claims.org_id is None or claims.role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access token required.",
        )

    user_id = _parse_uuid(claims.sub)
    user = await session.scalar(
        select(User).where(
            User.id == user_id,
            User.org_id == claims.org_id,
            User.is_active.is_(True),
        )
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User token is no longer valid.",
        )
    return UserIdentity(user_id=user.id, org_id=user.org_id, role=user.role, email=user.email)


def require_role(roles: Iterable[UserRole]):
    allowed_roles = set(roles)

    async def dependency(user: UserIdentity = Depends(get_current_user)) -> UserIdentity:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return user

    return dependency


async def validate_refresh_token(
    refresh_token: str,
    session: AsyncSession,
) -> tuple[TokenClaims, User]:
    claims = decode_token(refresh_token)
    if claims.token_type != TokenType.REFRESH or claims.org_id is None or claims.role is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required.",
        )
    if claims.jti is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is missing a token identifier.",
        )
    if await is_refresh_token_used(claims.jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has already been used.",
        )

    user_id = _parse_uuid(claims.sub)
    user = await session.scalar(
        select(User).where(
            User.id == user_id,
            User.org_id == claims.org_id,
            User.is_active.is_(True),
        )
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is no longer valid.",
        )
    return claims, user


def _parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication subject.",
        ) from exc
