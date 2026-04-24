from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_role
from app.database import get_session
from app.models import UserRole
from app.schemas.auth import (
    AcceptInviteRequest,
    InviteRequest,
    InviteResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
    UserIdentity,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth")


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    if request.client is None:
        return None
    return request.client.host


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> RegisterResponse:
    return await AuthService.register(session=session, payload=payload, ip_address=_client_ip(request))


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    return await AuthService.login(session=session, payload=payload, ip_address=_client_ip(request))


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> RefreshResponse:
    return await AuthService.refresh(
        session=session,
        refresh_token=payload.refresh_token,
        ip_address=_client_ip(request),
    )


@router.get("/me", response_model=MeResponse)
async def me(
    identity: UserIdentity = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    return await AuthService.me(session=session, identity=identity)


@router.post("/invite", response_model=InviteResponse)
async def invite(
    payload: InviteRequest,
    identity: UserIdentity = Depends(require_role([UserRole.ADMIN])),
    session: AsyncSession = Depends(get_session),
) -> InviteResponse:
    return await AuthService.invite(session=session, identity=identity, payload=payload)


@router.post("/accept-invite", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def accept_invite(
    payload: AcceptInviteRequest,
    request: Request,
    token: str = Query(..., min_length=1),
    session: AsyncSession = Depends(get_session),
) -> RegisterResponse:
    return await AuthService.accept_invite(
        session=session,
        token=token,
        payload=payload,
        ip_address=_client_ip(request),
    )
