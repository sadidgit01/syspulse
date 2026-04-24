import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKeyConstraint, Index, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CorrelationEvent(Base):
    __tablename__ = "correlation_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["agent_id", "org_id"],
            ["agents.id", "agents.org_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "org_id",
            "agent_id",
            "spike_metric",
            "spike_time",
            name="uq_correlation_events_org_agent_metric_time",
        ),
        Index("ix_correlation_events_org_created_at", "org_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    spike_metric: Mapped[str] = mapped_column(String(32), nullable=False)
    spike_value: Mapped[float] = mapped_column(Float, nullable=False)
    spike_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    correlated_logs: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    correlation_score: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
