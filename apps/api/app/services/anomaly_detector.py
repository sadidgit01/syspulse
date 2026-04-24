from __future__ import annotations

import logging
import pickle
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from fastapi import HTTPException, status
from sqlalchemy import desc, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BASE_DIR
from app.database import async_session_factory
from app.models import AnomalyEvent, Metric
from app.schemas.anomaly import AnomalyEventRead, AnomalyResult

logger = logging.getLogger(__name__)

FEATURE_COLUMNS = [
    "cpu_percent",
    "memory_percent",
    "disk_percent",
    "net_bytes_in",
    "net_bytes_out",
]


class AnomalyDetector:
    def __init__(self, model_dir: Path | None = None) -> None:
        self._models: dict[uuid.UUID, IsolationForest] = {}
        self._rolling_means: dict[uuid.UUID, dict[str, float]] = {}
        self._model_dir = model_dir or BASE_DIR / ".artifacts" / "anomaly_models"
        self._model_dir.mkdir(parents=True, exist_ok=True)

    async def train(self, agent_id: uuid.UUID, org_id: uuid.UUID) -> bool:
        async with async_session_factory() as session:
            window_start = datetime.now(timezone.utc) - timedelta(hours=24)
            metrics = (
                await session.execute(
                    select(
                        Metric.cpu,
                        Metric.memory,
                        Metric.disk,
                        Metric.net_in,
                        Metric.net_out,
                    )
                    .where(
                        Metric.agent_id == agent_id,
                        Metric.org_id == org_id,
                        Metric.time >= window_start,
                    )
                    .order_by(Metric.time.asc())
                )
            ).all()

        if len(metrics) < 50:
            logger.info(
                "Skipping anomaly model training for agent %s due to insufficient samples (%s).",
                agent_id,
                len(metrics),
            )
            return False

        dataframe = pd.DataFrame(
            [tuple(row) for row in metrics],
            columns=FEATURE_COLUMNS,
        )
        feature_matrix = dataframe.to_numpy(dtype=float)

        model = IsolationForest(
            contamination=0.05,
            random_state=42,
            n_estimators=100,
        )
        model.fit(feature_matrix)

        rolling_means = {
            "cpu_percent": float(dataframe["cpu_percent"].mean()),
            "memory_percent": float(dataframe["memory_percent"].mean()),
            "disk_percent": float(dataframe["disk_percent"].mean()),
            "net_bytes_in": float(dataframe["net_bytes_in"].mean()),
            "net_bytes_out": float(dataframe["net_bytes_out"].mean()),
        }
        self._models[agent_id] = model
        self._rolling_means[agent_id] = rolling_means
        self._persist_model(agent_id=agent_id, org_id=org_id, model=model, rolling_means=rolling_means)

        logger.info("Model trained for agent %s on %s samples", agent_id, len(metrics))
        return True

    def predict(self, agent_id: uuid.UUID, snapshot: dict[str, float | int | str]) -> AnomalyResult:
        model = self._models.get(agent_id)
        if model is None and not self._load_model(agent_id):
            return AnomalyResult(is_anomaly=False, score=0.0, reason="no_model", details={})

        model = self._models.get(agent_id)
        if model is None:
            return AnomalyResult(is_anomaly=False, score=0.0, reason="no_model", details={})

        feature_vector = np.array(
            [
                [
                    float(snapshot["cpu_percent"]),
                    float(snapshot["memory_percent"]),
                    float(snapshot["disk_percent"]),
                    float(snapshot["net_bytes_in"]),
                    float(snapshot["net_bytes_out"]),
                ]
            ],
            dtype=float,
        )

        prediction = int(model.predict(feature_vector)[0])
        decision_score = float(model.decision_function(feature_vector)[0])
        anomaly_score = _normalize_anomaly_score(decision_score)
        reason = self.get_contributing_metric(snapshot=snapshot, agent_id=agent_id)
        deviations = self._compute_deviations(snapshot=snapshot, agent_id=agent_id)
        highest_metric = max(deviations, key=deviations.get) if deviations else "none"

        return AnomalyResult(
            is_anomaly=prediction == -1,
            score=anomaly_score if prediction == -1 else 0.0,
            reason=reason if prediction == -1 else "none",
            details={
                "decision_score": decision_score,
                "primary_metric": highest_metric,
                "deviations": deviations,
                "rolling_mean": self._rolling_means.get(agent_id, {}),
            },
        )

    def get_contributing_metric(
        self,
        snapshot: dict[str, float | int | str],
        agent_id: uuid.UUID,
    ) -> str:
        rolling_means = self._rolling_means.get(agent_id)
        if not rolling_means:
            return "none"

        deviations = self._compute_deviations(snapshot=snapshot, agent_id=agent_id)
        if not deviations:
            return "none"

        elevated_metrics = [metric for metric, deviation in deviations.items() if deviation >= 1.5]
        if len(elevated_metrics) >= 2:
            return "multi_metric"

        primary_metric = max(deviations, key=deviations.get)
        if primary_metric in {"cpu_percent"}:
            return "cpu_spike"
        if primary_metric in {"memory_percent"}:
            return "memory_spike"
        if primary_metric in {"disk_percent"}:
            return "disk_spike"
        if primary_metric in {"net_bytes_in", "net_bytes_out"}:
            return "network_spike"
        return "none"

    async def record_event(
        self,
        session: AsyncSession,
        *,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        result: AnomalyResult,
        snapshot: dict[str, Any],
    ) -> AnomalyEventRead:
        payload = {
            "org_id": org_id,
            "agent_id": agent_id,
            "score": result.score,
            "reason": result.reason,
            "details": result.details,
            "snapshot": snapshot,
        }
        row = await session.scalar(insert(AnomalyEvent).values(payload).returning(AnomalyEvent))
        await session.commit()
        if row is None:
            raise RuntimeError("Failed to persist anomaly event.")
        return self._serialize_event(row)

    async def list_events(
        self,
        session: AsyncSession,
        *,
        org_id: uuid.UUID,
        agent_id: uuid.UUID | None,
        from_time,
        to_time,
        min_score: float,
    ) -> list[AnomalyEventRead]:
        if from_time is not None:
            from_time = _normalize_datetime(from_time)
        if to_time is not None:
            to_time = _normalize_datetime(to_time)
        if from_time is not None and to_time is not None and from_time > to_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The from timestamp must be earlier than the to timestamp.",
            )

        statement = (
            select(AnomalyEvent)
            .where(
                AnomalyEvent.org_id == org_id,
                AnomalyEvent.score >= min_score,
            )
            .order_by(desc(AnomalyEvent.created_at))
        )
        if agent_id is not None:
            statement = statement.where(AnomalyEvent.agent_id == agent_id)
        if from_time is not None:
            statement = statement.where(AnomalyEvent.created_at >= from_time)
        if to_time is not None:
            statement = statement.where(AnomalyEvent.created_at <= to_time)

        rows = (await session.scalars(statement)).all()
        return [self._serialize_event(row) for row in rows]

    async def get_agents_with_recent_data(
        self,
        *,
        active_within_hours: int = 25,
    ) -> list[tuple[uuid.UUID, uuid.UUID]]:
        threshold = datetime.now(timezone.utc) - timedelta(hours=active_within_hours)
        async with async_session_factory() as session:
            rows = (
                await session.execute(
                    select(Metric.agent_id, Metric.org_id)
                    .distinct()
                    .where(Metric.time >= threshold)
                )
            ).all()
        return [(row[0], row[1]) for row in rows]

    def _persist_model(
        self,
        *,
        agent_id: uuid.UUID,
        org_id: uuid.UUID,
        model: IsolationForest,
        rolling_means: dict[str, float],
    ) -> None:
        payload = {
            "org_id": str(org_id),
            "agent_id": str(agent_id),
            "model": model,
            "rolling_means": rolling_means,
        }
        with self._model_path(agent_id).open("wb") as file_handle:
            pickle.dump(payload, file_handle)

    def _load_model(self, agent_id: uuid.UUID) -> bool:
        model_path = self._model_path(agent_id)
        if not model_path.exists():
            return False

        try:
            with model_path.open("rb") as file_handle:
                payload = pickle.load(file_handle)
        except Exception:
            logger.exception("Failed to load anomaly model for agent %s", agent_id)
            return False

        model = payload.get("model")
        rolling_means = payload.get("rolling_means")
        if not isinstance(model, IsolationForest) or not isinstance(rolling_means, dict):
            return False

        self._models[agent_id] = model
        self._rolling_means[agent_id] = {
            key: float(value) for key, value in rolling_means.items()
        }
        return True

    def _model_path(self, agent_id: uuid.UUID) -> Path:
        return self._model_dir / f"{agent_id}.pkl"

    def _compute_deviations(
        self,
        *,
        snapshot: dict[str, float | int | str],
        agent_id: uuid.UUID,
    ) -> dict[str, float]:
        rolling_means = self._rolling_means.get(agent_id, {})
        deviations: dict[str, float] = {}
        for key in FEATURE_COLUMNS:
            baseline = float(rolling_means.get(key, 0.0))
            value = float(snapshot.get(key, 0.0))
            deviations[key] = value / max(baseline, 1.0)
        return deviations

    def _serialize_event(self, row: AnomalyEvent) -> AnomalyEventRead:
        return AnomalyEventRead(
            id=row.id,
            org_id=row.org_id,
            agent_id=row.agent_id,
            score=float(row.score),
            reason=row.reason,
            details=row.details or {},
            snapshot=row.snapshot or {},
            explanation=row.explanation,
            created_at=row.created_at,
        )


def _normalize_anomaly_score(decision_score: float) -> float:
    inverted = max(0.0, -decision_score)
    if inverted == 0.0:
        return 0.0
    return round(min(1.0, inverted / (inverted + 1.0)), 4)


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


anomaly_detector = AnomalyDetector()
