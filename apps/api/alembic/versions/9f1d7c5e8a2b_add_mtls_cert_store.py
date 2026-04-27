"""add_mtls_cert_store

Revision ID: 9f1d7c5e8a2b
Revises: 34245b952214
Create Date: 2026-04-27 00:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9f1d7c5e8a2b"
down_revision: str | None = "34245b952214"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("cert_fingerprint", sa.String(length=95), nullable=True))
    op.create_index(
        op.f("ix_agents_cert_fingerprint"),
        "agents",
        ["cert_fingerprint"],
        unique=False,
    )

    op.create_table(
        "cert_store",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("cert_pem", sa.Text(), nullable=False),
        sa.Column("key_pem", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(length=95), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name=op.f("fk_cert_store_agent_id_agents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.org_id"],
            name=op.f("fk_cert_store_org_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cert_store")),
    )
    op.create_index(op.f("ix_cert_store_agent_id"), "cert_store", ["agent_id"], unique=False)
    op.create_index(op.f("ix_cert_store_created_at"), "cert_store", ["created_at"], unique=False)
    op.create_index(op.f("ix_cert_store_expires_at"), "cert_store", ["expires_at"], unique=False)
    op.create_index(op.f("ix_cert_store_fingerprint"), "cert_store", ["fingerprint"], unique=False)
    op.create_index(op.f("ix_cert_store_org_id"), "cert_store", ["org_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_cert_store_org_id"), table_name="cert_store")
    op.drop_index(op.f("ix_cert_store_fingerprint"), table_name="cert_store")
    op.drop_index(op.f("ix_cert_store_expires_at"), table_name="cert_store")
    op.drop_index(op.f("ix_cert_store_created_at"), table_name="cert_store")
    op.drop_index(op.f("ix_cert_store_agent_id"), table_name="cert_store")
    op.drop_table("cert_store")
    op.drop_index(op.f("ix_agents_cert_fingerprint"), table_name="agents")
    op.drop_column("agents", "cert_fingerprint")
