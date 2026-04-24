import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


ForecastMetric = Literal["cpu_percent", "memory_percent", "disk_percent"]


@dataclass(slots=True)
class ForecastPoint:
    ds: datetime
    yhat: float
    yhat_lower: float
    yhat_upper: float

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["ds"] = self.ds.isoformat()
        return payload


@dataclass(slots=True)
class ForecastResult:
    metric: ForecastMetric
    agent_id: str
    current_value: float
    predicted_at: datetime | None
    predicted_value: float
    will_exceed_90: bool
    exceed_in_hours: float | None
    forecast_points: list[ForecastPoint]


class ForecastAlertRead(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    agent_id: uuid.UUID
    metric: ForecastMetric
    current_value: float
    predicted_value: float
    exceed_in_hours: float | None
    forecast_points: list[dict[str, Any]]
    explanation: str | None
    created_at: datetime
    is_sent: bool
