from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Agent,
    AnomalyEvent,
    CorrelationEvent,
    Incident,
    IncidentSeverity,
    IncidentStatus,
    IncidentTriggerType,
    LogEntry,
    Metric,
)
from app.redis_client import incidents_channel, publish_json
from app.schemas.incident import IncidentListResponse, IncidentRead, IncidentTimelineEvent
from app.services.llm_explainer import llm_explainer


class IncidentService:
    @staticmethod
    async def create_incident(
        session: AsyncSession,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        trigger_type: str,
        trigger_id: uuid.UUID | None,
        severity: IncidentSeverity,
        initial_event: dict[str, Any],
        *,
        title: str | None = None,
    ) -> IncidentRead:
        agent = await _get_agent(session, org_id, agent_id)
        event = _normalize_event(initial_event)
        incident = Incident(
            org_id=org_id,
            agent_id=agent_id,
            title=title or _build_incident_title(agent.hostname, trigger_type, event["title"]),
            status=IncidentStatus.OPEN,
            severity=severity,
            started_at=_parse_event_timestamp(event["timestamp"]),
            resolved_at=None,
            timeline_events=[event],
            trigger_type=trigger_type,
            trigger_id=trigger_id,
            summary=None,
        )
        session.add(incident)
        await session.commit()
        await session.refresh(incident)
        payload = _serialize_incident(incident)
        await publish_json(incidents_channel(org_id), payload.model_dump(mode="json"))
        return payload

    @staticmethod
    async def append_event(
        session: AsyncSession,
        incident_id: uuid.UUID,
        org_id: uuid.UUID,
        event: dict[str, Any],
    ) -> IncidentRead:
        incident = await _get_incident(session, incident_id, org_id)
        normalized_event = _normalize_event(event)
        incident.timeline_events = [*list(incident.timeline_events or []), normalized_event]
        incident.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(incident)
        payload = _serialize_incident(incident)
        await publish_json(incidents_channel(org_id), payload.model_dump(mode="json"))
        return payload

    @staticmethod
    async def auto_build_timeline(
        session: AsyncSession,
        incident_id: uuid.UUID,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        window_minutes: int = 30,
    ) -> list[IncidentTimelineEvent]:
        if window_minutes <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="window_minutes must be greater than zero.",
            )

        incident = await _get_incident(session, incident_id, org_id)
        agent = await _get_agent(session, org_id, agent_id)
        window_start = incident.started_at - timedelta(minutes=5)
        minimum_window_end = incident.started_at + timedelta(minutes=window_minutes)
        window_end = incident.resolved_at or max(
            incident.updated_at,
            minimum_window_end,
        )

        metrics = (
            await session.scalars(
                select(Metric)
                .where(
                    Metric.org_id == org_id,
                    Metric.agent_id == agent_id,
                    Metric.time >= window_start,
                    Metric.time <= window_end,
                )
                .order_by(Metric.time.asc())
            )
        ).all()
        logs = (
            await session.scalars(
                select(LogEntry)
                .where(
                    LogEntry.org_id == org_id,
                    LogEntry.agent_id == agent_id,
                    LogEntry.time >= window_start,
                    LogEntry.time <= window_end,
                )
                .order_by(LogEntry.time.asc())
            )
        ).all()
        anomalies = (
            await session.scalars(
                select(AnomalyEvent)
                .where(
                    AnomalyEvent.org_id == org_id,
                    AnomalyEvent.agent_id == agent_id,
                    AnomalyEvent.created_at >= window_start,
                    AnomalyEvent.created_at <= window_end,
                )
                .order_by(AnomalyEvent.created_at.asc())
            )
        ).all()
        correlations = (
            await session.scalars(
                select(CorrelationEvent)
                .where(
                    CorrelationEvent.org_id == org_id,
                    CorrelationEvent.agent_id == agent_id,
                    CorrelationEvent.created_at >= window_start,
                    CorrelationEvent.created_at <= window_end,
                )
                .order_by(CorrelationEvent.created_at.asc())
            )
        ).all()

        preserved_events = [
            IncidentTimelineEvent.model_validate(event)
            for event in list(incident.timeline_events or [])
            if str(event.get("type")) in {"comment", "status_change", "alert_fired"}
        ]
        built_events = [
            *preserved_events,
            *[_metric_event(metric) for metric in metrics],
            *[_log_event(log_entry) for log_entry in logs],
            *[_anomaly_event(anomaly) for anomaly in anomalies],
            *[_correlation_event(correlation) for correlation in correlations],
        ]
        built_events.sort(key=lambda event: event.timestamp)

        summary = llm_explainer.explain_incident(
            {
                "title": incident.title,
                "hostname": agent.hostname,
                "severity": incident.severity.value,
                "status": incident.status.value,
            },
            [event.model_dump(mode="json") for event in built_events],
        )

        incident.timeline_events = [event.model_dump(mode="json") for event in built_events]
        incident.summary = summary
        incident.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(incident)
        payload = _serialize_incident(incident)
        await publish_json(incidents_channel(org_id), payload.model_dump(mode="json"))
        return built_events

    @staticmethod
    async def resolve_incident(
        session: AsyncSession,
        incident_id: uuid.UUID,
        org_id: uuid.UUID,
        resolution_comment: str,
    ) -> IncidentRead:
        incident = await _get_incident(session, incident_id, org_id)
        resolved_at = datetime.now(timezone.utc)
        incident.status = IncidentStatus.RESOLVED
        incident.resolved_at = resolved_at
        incident.timeline_events = [
            *list(incident.timeline_events or []),
            _normalize_event(
                {
                    "event_id": str(uuid.uuid4()),
                    "timestamp": resolved_at.isoformat(),
                    "type": "status_change",
                    "title": "Incident resolved",
                    "detail": resolution_comment,
                    "metric_snapshot": None,
                    "severity": incident.severity.value,
                }
            ),
        ]
        incident.updated_at = resolved_at
        await session.commit()
        await session.refresh(incident)
        payload = _serialize_incident(incident)
        await publish_json(incidents_channel(org_id), payload.model_dump(mode="json"))
        return payload

    @staticmethod
    async def update_status(
        session: AsyncSession,
        incident_id: uuid.UUID,
        org_id: uuid.UUID,
        status_value: IncidentStatus,
        comment: str | None = None,
    ) -> IncidentRead:
        incident = await _get_incident(session, incident_id, org_id)
        incident.status = status_value
        incident.updated_at = datetime.now(timezone.utc)
        incident.timeline_events = [
            *list(incident.timeline_events or []),
            _normalize_event(
                {
                    "event_id": str(uuid.uuid4()),
                    "timestamp": incident.updated_at.isoformat(),
                    "type": "status_change",
                    "title": f"Incident marked {status_value.value}",
                    "detail": comment or f"Status changed to {status_value.value}.",
                    "metric_snapshot": None,
                    "severity": incident.severity.value,
                }
            ),
        ]
        if status_value == IncidentStatus.RESOLVED and incident.resolved_at is None:
            incident.resolved_at = incident.updated_at
        await session.commit()
        await session.refresh(incident)
        payload = _serialize_incident(incident)
        await publish_json(incidents_channel(org_id), payload.model_dump(mode="json"))
        return payload

    @staticmethod
    async def get_incidents(
        session: AsyncSession,
        org_id: uuid.UUID,
        *,
        status_filter: IncidentStatus | None = None,
        agent_id: uuid.UUID | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> IncidentListResponse:
        filters = [Incident.org_id == org_id]
        if status_filter is not None:
            filters.append(Incident.status == status_filter)
        if agent_id is not None:
            filters.append(Incident.agent_id == agent_id)

        total = int(
            (
                await session.scalar(
                    select(func.count())
                    .select_from(Incident)
                    .where(*filters)
                )
            )
            or 0
        )
        incidents = (
            await session.scalars(
                select(Incident)
                .where(*filters)
                .order_by(desc(Incident.started_at), desc(Incident.created_at))
                .offset(offset)
                .limit(limit)
            )
        ).all()
        return IncidentListResponse(
            incidents=[_serialize_incident(incident) for incident in incidents],
            total=total,
            limit=limit,
            offset=offset,
        )

    @staticmethod
    async def get_incident(
        session: AsyncSession,
        incident_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> IncidentRead:
        return _serialize_incident(await _get_incident(session, incident_id, org_id))

    @staticmethod
    async def get_open_incident_for_agent(
        session: AsyncSession,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
    ) -> Incident | None:
        return await session.scalar(
            select(Incident)
            .where(
                Incident.org_id == org_id,
                Incident.agent_id == agent_id,
                Incident.status != IncidentStatus.RESOLVED,
            )
            .order_by(desc(Incident.started_at))
        )


async def _get_incident(session: AsyncSession, incident_id: uuid.UUID, org_id: uuid.UUID) -> Incident:
    incident = await session.scalar(
        select(Incident).where(Incident.id == incident_id, Incident.org_id == org_id)
    )
    if incident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found.",
        )
    return incident


async def _get_agent(session: AsyncSession, org_id: uuid.UUID, agent_id: uuid.UUID) -> Agent:
    agent = await session.scalar(
        select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id)
    )
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found.",
        )
    return agent


def _serialize_incident(incident: Incident) -> IncidentRead:
    return IncidentRead(
        id=incident.id,
        org_id=incident.org_id,
        agent_id=incident.agent_id,
        title=incident.title,
        status=incident.status,
        severity=incident.severity,
        started_at=incident.started_at,
        resolved_at=incident.resolved_at,
        timeline_events=[
            IncidentTimelineEvent.model_validate(event) for event in list(incident.timeline_events or [])
        ],
        trigger_type=incident.trigger_type,
        trigger_id=incident.trigger_id,
        summary=incident.summary,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


def _normalize_event(event: dict[str, Any]) -> dict[str, Any]:
    parsed = IncidentTimelineEvent.model_validate(event)
    return parsed.model_dump(mode="json")


def _parse_event_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _build_incident_title(hostname: str, trigger_type: str, event_title: str) -> str:
    if trigger_type == IncidentTriggerType.ANOMALY.value:
        return f"{event_title} on {hostname}"
    if trigger_type == IncidentTriggerType.CORRELATION.value:
        return f"Correlated fault on {hostname}"
    if trigger_type == IncidentTriggerType.FORECAST.value:
        return f"Forecast warning on {hostname}"
    if trigger_type == IncidentTriggerType.ALERT.value:
        return f"Alert fired on {hostname}"
    return f"Incident on {hostname}"


def _metric_event(metric: Metric) -> IncidentTimelineEvent:
    top_metric = max(
        (
            ("cpu", float(metric.cpu)),
            ("memory", float(metric.memory)),
            ("disk", float(metric.disk)),
        ),
        key=lambda item: item[1],
    )
    return IncidentTimelineEvent(
        event_id=str(uuid.uuid4()),
        timestamp=metric.time.isoformat(),
        type="metric_spike",
        title=f"{top_metric[0].upper()} pressure observed",
        detail=(
            f"CPU {float(metric.cpu):.1f}%, memory {float(metric.memory):.1f}%, "
            f"disk {float(metric.disk):.1f}%"
        ),
        metric_snapshot={
            "cpu": float(metric.cpu),
            "memory": float(metric.memory),
            "disk": float(metric.disk),
        },
        severity=_severity_from_metric_snapshot(float(metric.cpu), float(metric.memory), float(metric.disk)),
    )


def _log_event(log_entry: LogEntry) -> IncidentTimelineEvent:
    return IncidentTimelineEvent(
        event_id=str(log_entry.id),
        timestamp=log_entry.time.isoformat(),
        type="log_error" if log_entry.level in {"ERROR", "CRITICAL"} else "comment",
        title=f"{log_entry.level} from {log_entry.source}",
        detail=log_entry.message,
        metric_snapshot=None,
        severity=_severity_from_log_level(log_entry.level),
    )


def _anomaly_event(anomaly: AnomalyEvent) -> IncidentTimelineEvent:
    snapshot = anomaly.snapshot or {}
    metric_snapshot = None
    if snapshot:
        metric_snapshot = {
            "cpu": float(snapshot.get("cpu_percent", 0.0)),
            "memory": float(snapshot.get("memory_percent", 0.0)),
            "disk": float(snapshot.get("disk_percent", 0.0)),
        }
    return IncidentTimelineEvent(
        event_id=str(anomaly.id),
        timestamp=anomaly.created_at.isoformat(),
        type="anomaly",
        title=f"Anomaly detected: {anomaly.reason}",
        detail=anomaly.explanation or f"Anomaly score {float(anomaly.score):.2f}",
        metric_snapshot=metric_snapshot,
        severity=_severity_from_score(float(anomaly.score)),
    )


def _correlation_event(correlation: CorrelationEvent) -> IncidentTimelineEvent:
    severity = (
        IncidentSeverity.CRITICAL
        if correlation.severity == "critical"
        else IncidentSeverity.HIGH
    )
    return IncidentTimelineEvent(
        event_id=str(correlation.id),
        timestamp=correlation.created_at.isoformat(),
        type="correlation",
        title=f"{correlation.spike_metric.upper()} spike correlated with errors",
        detail=f"Correlation score {float(correlation.correlation_score):.2f}",
        metric_snapshot=None,
        severity=severity,
    )


def _severity_from_metric_snapshot(cpu: float, memory: float, disk: float) -> IncidentSeverity:
    highest = max(cpu, memory, disk)
    if highest >= 90:
        return IncidentSeverity.CRITICAL
    if highest >= 80:
        return IncidentSeverity.HIGH
    if highest >= 65:
        return IncidentSeverity.MEDIUM
    return IncidentSeverity.LOW


def _severity_from_log_level(level: str) -> IncidentSeverity:
    if level == "CRITICAL":
        return IncidentSeverity.CRITICAL
    if level == "ERROR":
        return IncidentSeverity.HIGH
    if level == "WARNING":
        return IncidentSeverity.MEDIUM
    return IncidentSeverity.LOW


def _severity_from_score(score: float) -> IncidentSeverity:
    if score > 0.8:
        return IncidentSeverity.CRITICAL
    if score > 0.6:
        return IncidentSeverity.HIGH
    if score > 0.4:
        return IncidentSeverity.MEDIUM
    return IncidentSeverity.LOW
