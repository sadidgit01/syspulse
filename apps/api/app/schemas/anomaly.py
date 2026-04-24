import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel


@dataclass(slots=True)
class AnomalyResult:
    is_anomaly: bool
    score: float
    reason: str
    details: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AnomalyEventRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    agent_id: uuid.UUID
    score: float
    reason: str
    details: dict[str, Any]
    snapshot: dict[str, Any]
    explanation: str | None
    created_at: datetime
