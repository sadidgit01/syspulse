import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKeyConstraint, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Metric(Base):
    __tablename__ = "metrics"
    __table_args__ = (
        ForeignKeyConstraint(
            ["agent_id", "org_id"],
            ["agents.id", "agents.org_id"],
            ondelete="CASCADE",
        ),
        Index("ix_metrics_org_agent_time", "org_id", "agent_id", "time"),
    )

    time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
        nullable=False,
        server_default=func.now(),
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, nullable=False, index=True)
    cpu: Mapped[float] = mapped_column(Float, nullable=False)
    memory: Mapped[float] = mapped_column(Float, nullable=False)
    disk: Mapped[float] = mapped_column(Float, nullable=False)
    net_in: Mapped[float] = mapped_column(Float, nullable=False)
    net_out: Mapped[float] = mapped_column(Float, nullable=False)

    agent = relationship("Agent", back_populates="metrics")
