import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.incident import IncidentSeverity


class AlertRuleConditionType(StrEnum):
    THRESHOLD = "threshold"
    RELATIVE = "relative"
    COMPOSITE = "composite"
    ANOMALY_SCORE = "anomaly_score"


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.org_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(
        nullable=False,
        default=True,
        server_default=text("TRUE"),
    )
    condition_type: Mapped[AlertRuleConditionType] = mapped_column(
        Enum(
            AlertRuleConditionType,
            name="alert_rule_condition_type",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    condition_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    severity: Mapped[IncidentSeverity] = mapped_column(
        Enum(
            IncidentSeverity,
            name="incident_severity",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    channels_json: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False, default=list)
    cooldown_minutes: Mapped[int] = mapped_column(nullable=False, default=30, server_default=text("30"))
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
