import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKeyConstraint, Float, Index, JSON, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ForecastAlert(Base):
    __tablename__ = "forecast_alerts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["agent_id", "org_id"],
            ["agents.id", "agents.org_id"],
            ondelete="CASCADE",
        ),
        Index("ix_forecast_alerts_org_agent_created_at", "org_id", "agent_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    metric: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    current_value: Mapped[float] = mapped_column(Float, nullable=False)
    predicted_value: Mapped[float] = mapped_column(Float, nullable=False)
    exceed_in_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast_points: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    explanation: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    is_sent: Mapped[bool] = mapped_column(nullable=False, server_default=text("FALSE"), default=False)
