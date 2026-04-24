import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKeyConstraint, Float, Index, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AnomalyEvent(Base):
    __tablename__ = "anomaly_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["agent_id", "org_id"],
            ["agents.id", "agents.org_id"],
            ondelete="CASCADE",
        ),
        Index("ix_anomaly_events_org_agent_created_at", "org_id", "agent_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    snapshot: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    explanation: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
