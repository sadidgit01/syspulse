from collections.abc import AsyncGenerator

from sqlalchemy import MetaData, text
from sqlalchemy.ext.asyncio import AsyncAttrs, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(AsyncAttrs, DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
)
async_session_factory = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


async def initialize_database() -> None:
    from app import models  # noqa: F401

    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(
            text(
                "SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE, migrate_data => TRUE)"
            )
        )
        await connection.execute(
            text(
                "SELECT create_hypertable('log_entries', 'time', if_not_exists => TRUE, migrate_data => TRUE)"
            )
        )
        await connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_log_entries_org_id ON log_entries (org_id)")
        )
        await connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_log_entries_agent_id ON log_entries (agent_id)")
        )
        await connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_log_entries_level ON log_entries (level)")
        )
        await connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_log_entries_source ON log_entries (source)")
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_log_entries_message_tsv "
                "ON log_entries USING GIN (to_tsvector('english', message))"
            )
        )
        await connection.execute(
            text(
                "SELECT add_retention_policy('log_entries', INTERVAL '90 days', if_not_exists => TRUE)"
            )
        )


async def check_database_health() -> bool:
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def close_database() -> None:
    await engine.dispose()
