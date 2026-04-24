from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import get_settings
from app.database import get_session
from app.models import Agent, User
from app.schemas.agent import AgentIdentity
from app.schemas.auth import TokenClaims, TokenType, UserIdentity

settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)
JWT_ALGORITHM = "HS256"
AGENT_TOKEN_TTL = timedelta(days=30)


def create_agent_token(agent_id: UUID, org_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(agent_id),
        "org_id": str(org_id),
        "token_type": TokenType.AGENT.value,
        "iat": int(now.timestamp()),
        "exp": int((now + AGENT_TOKEN_TTL).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> TokenClaims:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[JWT_ALGORITHM])
    except ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
        ) from exc
    except InvalidTokenError as exc:
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
    if claims.token_type != TokenType.AGENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent token required.",
        )

    agent = await session.scalar(
        select(Agent).where(
            Agent.id == claims.sub,
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
    if claims.token_type != TokenType.USER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User token required.",
        )

    user = await session.scalar(
        select(User).where(
            User.id == claims.sub,
            User.org_id == claims.org_id,
            User.is_active.is_(True),
        )
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User token is no longer valid.",
        )
    return UserIdentity(user_id=user.id, org_id=user.org_id, role=user.role.value)
