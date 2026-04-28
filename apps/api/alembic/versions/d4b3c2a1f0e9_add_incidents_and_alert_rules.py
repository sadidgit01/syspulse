"""add incidents and alert rules

Revision ID: d4b3c2a1f0e9
Revises: 9f1d7c5e8a2b
Create Date: 2026-04-28 00:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4b3c2a1f0e9"
down_revision: str | None = "9f1d7c5e8a2b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


incident_status_enum = sa.Enum(
    "open",
    "investigating",
    "resolved",
    name="incident_status",
)
incident_severity_enum = sa.Enum(
    "low",
    "medium",
    "high",
    "critical",
    name="incident_severity",
)
alert_rule_condition_type_enum = sa.Enum(
    "threshold",
    "relative",
    "composite",
    "anomaly_score",
    name="alert_rule_condition_type",
)


def upgrade() -> None:
    bind = op.get_bind()
    incident_status_enum.create(bind, checkfirst=True)
    incident_severity_enum.create(bind, checkfirst=True)
    alert_rule_condition_type_enum.create(bind, checkfirst=True)

    op.create_table(
        "incidents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            incident_status_enum,
            nullable=False,
            server_default=sa.text("'open'"),
        ),
        sa.Column("severity", incident_severity_enum, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timeline_events", sa.JSON(), nullable=False),
        sa.Column("trigger_type", sa.String(length=32), nullable=False),
        sa.Column("trigger_id", sa.Uuid(), nullable=True),
        sa.Column("summary", sa.String(length=2048), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["agent_id", "org_id"],
            ["agents.id", "agents.org_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_incidents")),
    )
    op.create_index(op.f("ix_incidents_agent_id"), "incidents", ["agent_id"], unique=False)
    op.create_index(op.f("ix_incidents_org_id"), "incidents", ["org_id"], unique=False)
    op.create_index(
        "ix_incidents_org_status_started_at",
        "incidents",
        ["org_id", "status", "started_at"],
        unique=False,
    )

    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("TRUE"),
        ),
        sa.Column("condition_type", alert_rule_condition_type_enum, nullable=False),
        sa.Column("condition_json", sa.JSON(), nullable=False),
        sa.Column("severity", incident_severity_enum, nullable=False),
        sa.Column("channels_json", sa.JSON(), nullable=False),
        sa.Column(
            "cooldown_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("30"),
        ),
        sa.Column("last_fired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.org_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alert_rules")),
    )
    op.create_index(op.f("ix_alert_rules_created_by"), "alert_rules", ["created_by"], unique=False)
    op.create_index(op.f("ix_alert_rules_org_id"), "alert_rules", ["org_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_alert_rules_org_id"), table_name="alert_rules")
    op.drop_index(op.f("ix_alert_rules_created_by"), table_name="alert_rules")
    op.drop_table("alert_rules")

    op.drop_index("ix_incidents_org_status_started_at", table_name="incidents")
    op.drop_index(op.f("ix_incidents_org_id"), table_name="incidents")
    op.drop_index(op.f("ix_incidents_agent_id"), table_name="incidents")
    op.drop_table("incidents")

    bind = op.get_bind()
    alert_rule_condition_type_enum.drop(bind, checkfirst=True)
    incident_severity_enum.drop(bind, checkfirst=True)
    incident_status_enum.drop(bind, checkfirst=True)
