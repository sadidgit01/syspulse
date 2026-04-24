import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKeyConstraint, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LogEntry(Base):
    __tablename__ = "log_entries"
    __table_args__ = (
        ForeignKeyConstraint(
            ["agent_id", "org_id"],
            ["agents.id", "agents.org_id"],
            ondelete="CASCADE",
        ),
        Index("ix_log_entries_org_agent_time", "org_id", "agent_id", "time"),
        Index("ix_log_entries_org_agent_level_source_time", "org_id", "agent_id", "level", "source", "time"),
    )

    time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
        nullable=False,
        server_default=func.now(),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    agent = relationship("Agent", back_populates="log_entries")
