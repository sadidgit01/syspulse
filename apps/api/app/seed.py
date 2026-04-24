import asyncio
from dataclasses import dataclass

from sqlalchemy import select

from app.auth import create_user_token
from app.database import async_session_factory
from app.models import Organization, User, UserRole


@dataclass(frozen=True)
class SeedResult:
    organization_name: str
    organization_slug: str
    organization_token: str
    admin_email: str
    admin_password: str
    user_token: str


async def seed() -> SeedResult:
    async with async_session_factory() as session:
        organization = await session.scalar(
            select(Organization).where(Organization.slug == "local-dev")
        )
        if organization is None:
            organization = Organization(name="SysPulse Local", slug="local-dev")
            session.add(organization)
            await session.flush()

        admin_user = await session.scalar(
            select(User).where(
                User.org_id == organization.org_id,
                User.email == "admin@syspulse.local",
            )
        )
        password = "changeme123!"
        if admin_user is None:
            admin_user = User(
                org_id=organization.org_id,
                email="admin@syspulse.local",
                full_name="SysPulse Local Admin",
                role=UserRole.OWNER,
            )
            admin_user.set_password(password)
            session.add(admin_user)
            await session.flush()
        elif not admin_user.verify_password(password):
            admin_user.set_password(password)

        await session.commit()

        token = create_user_token(
            user_id=admin_user.id,
            org_id=organization.org_id,
            role=admin_user.role.value,
        )

        return SeedResult(
            organization_name=organization.name,
            organization_slug=organization.slug,
            organization_token=organization.org_token,
            admin_email=admin_user.email,
            admin_password=password,
            user_token=token,
        )


def main() -> None:
    result = asyncio.run(seed())
    print("Seed complete")
    print(f"Organization: {result.organization_name} ({result.organization_slug})")
    print(f"Organization token: {result.organization_token}")
    print(f"Admin email: {result.admin_email}")
    print(f"Admin password: {result.admin_password}")
    print(f"User JWT: {result.user_token}")


if __name__ == "__main__":
    main()
