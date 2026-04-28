import asyncio

from sqlalchemy import select

from app.database import async_session_factory
from app.models import Organization, User, UserRole

DEMO_EMAIL = "demo@syspulse.io"
DEMO_PASSWORD = "demo123"
DEMO_ORG_NAME = "SysPulse Demo"
DEMO_ORG_SLUG = "syspulse-demo"


async def seed_demo() -> None:
    async with async_session_factory() as session:
        organization = await session.scalar(
            select(Organization).where(Organization.slug == DEMO_ORG_SLUG)
        )
        if organization is None:
            organization = Organization(
                name=DEMO_ORG_NAME,
                slug=DEMO_ORG_SLUG,
            )
            session.add(organization)
            await session.flush()

        user = await session.scalar(select(User).where(User.email == DEMO_EMAIL))
        if user is None:
            user = User(
                org_id=organization.org_id,
                email=DEMO_EMAIL,
                full_name="SysPulse Demo",
                role=UserRole.ADMIN,
            )
            user.set_password(DEMO_PASSWORD)
            session.add(user)

        await session.commit()
        await session.refresh(organization)

        print("SysPulse demo seed ready")
        print(f"Email: {DEMO_EMAIL}")
        print(f"Password: {DEMO_PASSWORD}")
        print(f"Org token: {organization.org_token}")


def main() -> None:
    asyncio.run(seed_demo())


if __name__ == "__main__":
    main()
