import uuid
from datetime import datetime
from enum import StrEnum

from passlib.context import CryptContext
from sqlalchemy import DateTime, Enum, ForeignKey, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserRole(StrEnum):
    ADMIN = "admin"
    VIEWER = "viewer"
    ALERT_MANAGER = "alert_manager"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.org_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=UserRole.VIEWER,
        server_default=UserRole.VIEWER.value,
    )
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default=text("TRUE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    organization = relationship("Organization", back_populates="users")

    def set_password(self, raw_password: str) -> None:
        self.password_hash = password_context.hash(raw_password)

    def verify_password(self, raw_password: str) -> bool:
        return password_context.verify(raw_password, self.password_hash)
