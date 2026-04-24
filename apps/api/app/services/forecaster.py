from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd
from prophet import Prophet
from sqlalchemy import desc, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory
from app.models import Agent, ForecastAlert, Metric
from app.schemas.forecast import ForecastAlertRead, ForecastMetric, ForecastPoint, ForecastResult

logger = logging.getLogger(__name__)

METRIC_COLUMN_MAP = {
    "cpu_percent": Metric.cpu,
    "memory_percent": Metric.memory,
    "disk_percent": Metric.disk,
}


class MetricForecaster:
    async def forecast(
        self,
        agent_id: uuid.UUID,
        org_id: uuid.UUID,
        metric: ForecastMetric,
        hours_ahead: int = 6,
    ) -> ForecastResult | None:
        if metric not in METRIC_COLUMN_MAP:
            raise ValueError(f"Unsupported metric: {metric}")
        if hours_ahead <= 0:
            raise ValueError("hours_ahead must be greater than zero.")

        metric_column = METRIC_COLUMN_MAP[metric]
        window_start = datetime.now(timezone.utc) - timedelta(days=7)

        async with async_session_factory() as session:
            rows = (
                await session.execute(
                    select(Metric.time, metric_column.label("value"))
                    .where(
                        Metric.agent_id == agent_id,
                        Metric.org_id == org_id,
                        Metric.time >= window_start,
                    )
                    .order_by(Metric.time.asc())
                )
            ).all()

        if len(rows) < 200:
            return None

        history = pd.DataFrame(
            {
                "ds": [row.time for row in rows],
                "y": [float(row.value) for row in rows],
            }
        )

        model = Prophet(
            daily_seasonality=True,
            weekly_seasonality=True,
            interval_width=0.95,
        )
        model.fit(history)

        future = model.make_future_dataframe(periods=hours_ahead * 60, freq="min", include_history=True)
        forecast_frame = model.predict(future)

        now = pd.Timestamp.now(tz="UTC")
        future_rows = forecast_frame[forecast_frame["ds"] > now]
        predicted_terminal = future_rows.iloc[-1] if not future_rows.empty else forecast_frame.iloc[-1]
        threshold_rows = future_rows[future_rows["yhat"] >= 90.0]
        first_exceed = threshold_rows.iloc[0] if not threshold_rows.empty else None

        history_window_start = now - pd.Timedelta(hours=12)
        displayed_points = forecast_frame[forecast_frame["ds"] >= history_window_start]

        forecast_points = [
            ForecastPoint(
                ds=_ensure_utc_datetime(row.ds),
                yhat=float(row.yhat),
                yhat_lower=float(row.yhat_lower),
                yhat_upper=float(row.yhat_upper),
            )
            for row in displayed_points.itertuples(index=False)
        ]

        exceed_in_hours = None
        predicted_at = None
        will_exceed_90 = first_exceed is not None
        if first_exceed is not None:
            predicted_at = _ensure_utc_datetime(first_exceed.ds)
            exceed_in_hours = round(
                max(0.0, (predicted_at - datetime.now(timezone.utc)).total_seconds() / 3600.0),
                3,
            )

        return ForecastResult(
            metric=metric,
            agent_id=str(agent_id),
            current_value=float(history["y"].iloc[-1]),
            predicted_at=predicted_at,
            predicted_value=float(predicted_terminal.yhat),
            will_exceed_90=will_exceed_90,
            exceed_in_hours=exceed_in_hours,
            forecast_points=forecast_points,
        )

    async def check_all_agents(self, org_id: uuid.UUID) -> list[ForecastAlertRead]:
        async with async_session_factory() as session:
            agents = (
                await session.scalars(
                    select(Agent).where(Agent.org_id == org_id).order_by(Agent.hostname.asc())
                )
            ).all()

            created_alerts: list[ForecastAlertRead] = []
            for agent in agents:
                for metric in ("cpu_percent", "memory_percent", "disk_percent"):
                    result = await self.forecast(
                        agent_id=agent.id,
                        org_id=org_id,
                        metric=metric,
                    )
                    if result is None or not result.will_exceed_90:
                        continue

                    alert = await self._store_alert(
                        session=session,
                        org_id=org_id,
                        agent_id=agent.id,
                        result=result,
                    )
                    created_alerts.append(alert)

            return created_alerts

    async def get_latest_alerts(
        self,
        session: AsyncSession,
        *,
        org_id: uuid.UUID,
        agent_id: uuid.UUID | None,
        metric: ForecastMetric | None,
    ) -> list[ForecastAlertRead]:
        filters = [ForecastAlert.org_id == org_id]
        if agent_id is not None:
            filters.append(ForecastAlert.agent_id == agent_id)
        if metric is not None:
            filters.append(ForecastAlert.metric == metric)

        latest_created_at = (
            select(
                ForecastAlert.agent_id.label("agent_id"),
                ForecastAlert.metric.label("metric"),
                func.max(ForecastAlert.created_at).label("max_created_at"),
            )
            .where(*filters)
            .group_by(ForecastAlert.agent_id, ForecastAlert.metric)
            .subquery()
        )

        rows = (
            await session.scalars(
                select(ForecastAlert)
                .join(
                    latest_created_at,
                    (ForecastAlert.agent_id == latest_created_at.c.agent_id)
                    & (ForecastAlert.metric == latest_created_at.c.metric)
                    & (ForecastAlert.created_at == latest_created_at.c.max_created_at),
                )
                .order_by(desc(ForecastAlert.created_at), ForecastAlert.metric.asc())
            )
        ).all()
        return [self._serialize_alert(row) for row in rows]

    async def get_active_org_ids(
        self,
        *,
        active_within_hours: int = 24,
    ) -> list[uuid.UUID]:
        threshold = datetime.now(timezone.utc) - timedelta(hours=active_within_hours)
        async with async_session_factory() as session:
            rows = (
                await session.scalars(
                    select(Metric.org_id).distinct().where(Metric.time >= threshold)
                )
            ).all()
        return list(rows)

    async def _store_alert(
        self,
        *,
        session: AsyncSession,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        result: ForecastResult,
    ) -> ForecastAlertRead:
        payload = {
            "org_id": org_id,
            "agent_id": agent_id,
            "metric": result.metric,
            "current_value": result.current_value,
            "predicted_value": result.predicted_value,
            "exceed_in_hours": result.exceed_in_hours,
            "forecast_points": [point.to_dict() for point in result.forecast_points],
            "is_sent": False,
        }
        row = await session.scalar(insert(ForecastAlert).values(payload).returning(ForecastAlert))
        await session.commit()
        if row is None:
            raise RuntimeError("Failed to persist forecast alert.")
        return self._serialize_alert(row)

    def _serialize_alert(self, row: ForecastAlert) -> ForecastAlertRead:
        return ForecastAlertRead(
            id=row.id,
            org_id=row.org_id,
            agent_id=row.agent_id,
            metric=row.metric,  # type: ignore[arg-type]
            current_value=float(row.current_value),
            predicted_value=float(row.predicted_value),
            exceed_in_hours=float(row.exceed_in_hours) if row.exceed_in_hours is not None else None,
            forecast_points=row.forecast_points or [],
            explanation=row.explanation,
            created_at=row.created_at,
            is_sent=bool(row.is_sent),
        )


def _ensure_utc_datetime(value: pd.Timestamp | datetime) -> datetime:
    if isinstance(value, pd.Timestamp):
        if value.tzinfo is None:
            return value.tz_localize("UTC").to_pydatetime()
        return value.tz_convert("UTC").to_pydatetime()
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


forecaster = MetricForecaster()
