from __future__ import annotations

import re
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    create_access_token,
    create_invite_token,
    create_refresh_token,
    decode_token,
    validate_refresh_token,
)
from app.models import AuditLog, Organization, User, UserRole
from app.redis_client import mark_refresh_token_used
from app.schemas.auth import (
    AcceptInviteRequest,
    InviteRequest,
    InviteResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    OrganizationRead,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
    TokenType,
    UserIdentity,
    UserRead,
)


class AuthService:
    @staticmethod
    async def register(
        session: AsyncSession,
        payload: RegisterRequest,
        ip_address: str | None,
    ) -> RegisterResponse:
        existing_user = await session.scalar(select(User).where(User.email == payload.email))
        if existing_user is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists.",
            )

        organization = Organization(
            name=payload.org_name,
            slug=await AuthService._generate_unique_slug(session, payload.org_name),
        )
        try:
            session.add(organization)
            await session.flush()

            user = User(
                org_id=organization.org_id,
                email=payload.email,
                full_name=AuthService._derive_full_name(payload.email),
                role=UserRole.ADMIN,
            )
            user.set_password(payload.password)
            session.add(user)
            await session.flush()

            await AuthService._write_audit_log(
                session=session,
                action="user_registered",
                org_id=organization.org_id,
                user_id=user.id,
                ip_address=ip_address,
                metadata_json={"email": user.email, "role": user.role.value},
            )
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Unable to create the organization and admin user with the provided details.",
            ) from exc

        access_token = create_access_token(user.id, organization.org_id, user.role)
        refresh_token = create_refresh_token(user.id, organization.org_id, user.role)
        return RegisterResponse(
            user_id=user.id,
            org_id=organization.org_id,
            org_token=organization.org_token,
            access_token=access_token,
            refresh_token=refresh_token,
        )

    @staticmethod
    async def login(
        session: AsyncSession,
        payload: LoginRequest,
        ip_address: str | None,
    ) -> LoginResponse:
        user = await session.scalar(select(User).where(User.email == payload.email))
        if user is None or not user.verify_password(payload.password):
            await AuthService._write_audit_log(
                session=session,
                action="login_failed",
                org_id=user.org_id if user is not None else None,
                user_id=user.id if user is not None else None,
                ip_address=ip_address,
                metadata_json={"email": payload.email},
            )
            await session.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        await AuthService._write_audit_log(
            session=session,
            action="user_login",
            org_id=user.org_id,
            user_id=user.id,
            ip_address=ip_address,
            metadata_json={"email": user.email},
        )
        await session.commit()

        access_token = create_access_token(user.id, user.org_id, user.role)
        refresh_token = create_refresh_token(user.id, user.org_id, user.role)
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            user=UserRead(
                id=user.id,
                org_id=user.org_id,
                email=user.email,
                full_name=user.full_name,
                role=user.role,
                created_at=user.created_at,
            ),
        )

    @staticmethod
    async def refresh(
        session: AsyncSession,
        refresh_token: str,
        ip_address: str | None,
    ) -> RefreshResponse:
        claims, user = await validate_refresh_token(refresh_token, session)
        await mark_refresh_token_used(claims.jti or "", claims.exp)
        await AuthService._write_audit_log(
            session=session,
            action="token_refreshed",
            org_id=user.org_id,
            user_id=user.id,
            ip_address=ip_address,
            metadata_json={"email": user.email},
        )
        await session.commit()

        return RefreshResponse(
            access_token=create_access_token(user.id, user.org_id, user.role),
            refresh_token=create_refresh_token(user.id, user.org_id, user.role),
        )

    @staticmethod
    async def me(session: AsyncSession, identity: UserIdentity) -> MeResponse:
        user = await session.scalar(
            select(User).where(
                User.id == identity.user_id,
                User.org_id == identity.org_id,
            )
        )
        organization = await session.scalar(
            select(Organization).where(Organization.org_id == identity.org_id)
        )
        if user is None or organization is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Authenticated user could not be found.",
            )

        return MeResponse(
            user=UserRead(
                id=user.id,
                org_id=user.org_id,
                email=user.email,
                full_name=user.full_name,
                role=user.role,
                created_at=user.created_at,
            ),
            organization=OrganizationRead(
                org_id=organization.org_id,
                name=organization.name,
                slug=organization.slug,
                org_token=organization.org_token,
            ),
            role=user.role,
        )

    @staticmethod
    async def invite(
        session: AsyncSession,
        identity: UserIdentity,
        payload: InviteRequest,
    ) -> InviteResponse:
        existing_user = await session.scalar(select(User).where(User.email == payload.email))
        if existing_user is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists.",
            )

        token = create_invite_token(identity.org_id, payload.email, payload.role)
        return InviteResponse(
            invite_link=f"/auth/accept-invite?token={token}",
            invite_token=token,
        )

    @staticmethod
    async def accept_invite(
        session: AsyncSession,
        token: str,
        payload: AcceptInviteRequest,
        ip_address: str | None,
    ) -> RegisterResponse:
        claims = decode_token(token)
        if claims.token_type != TokenType.INVITE or claims.org_id is None or claims.role is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invite token required.",
            )
        if claims.email is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invite token is missing the invited email.",
            )

        organization = await session.scalar(
            select(Organization).where(Organization.org_id == claims.org_id)
        )
        if organization is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found for this invite.",
            )

        existing_user = await session.scalar(select(User).where(User.email == claims.email))
        if existing_user is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists.",
            )

        user = User(
            org_id=organization.org_id,
            email=claims.email,
            full_name=AuthService._derive_full_name(claims.email),
            role=claims.role,
        )
        user.set_password(payload.password)
        try:
            session.add(user)
            await session.flush()

            await AuthService._write_audit_log(
                session=session,
                action="user_registered",
                org_id=organization.org_id,
                user_id=user.id,
                ip_address=ip_address,
                metadata_json={"email": user.email, "role": user.role.value, "via": "invite"},
            )
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Unable to accept this invite with the provided credentials.",
            ) from exc

        return RegisterResponse(
            user_id=user.id,
            org_id=organization.org_id,
            org_token=organization.org_token,
            access_token=create_access_token(user.id, organization.org_id, user.role),
            refresh_token=create_refresh_token(user.id, organization.org_id, user.role),
        )

    @staticmethod
    async def _write_audit_log(
        *,
        session: AsyncSession,
        action: str,
        org_id: UUID | None,
        user_id: UUID | None,
        ip_address: str | None,
        metadata_json: dict[str, object],
    ) -> None:
        session.add(
            AuditLog(
                org_id=org_id,
                user_id=user_id,
                action=action,
                ip_address=ip_address,
                metadata_json=metadata_json,
            )
        )

    @staticmethod
    async def _generate_unique_slug(session: AsyncSession, org_name: str) -> str:
        base_slug = AuthService._slugify(org_name)
        slug = base_slug
        suffix = 1

        while await session.scalar(select(Organization).where(Organization.slug == slug)) is not None:
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        return slug

    @staticmethod
    def _slugify(value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
        return normalized or "organization"

    @staticmethod
    def _derive_full_name(email: str) -> str:
        local_part = email.split("@", 1)[0]
        words = [part.capitalize() for part in re.split(r"[._-]+", local_part) if part]
        return " ".join(words) or email
