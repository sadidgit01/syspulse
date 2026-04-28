from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory
from app.models import (
    Agent,
    AlertRule,
    AlertRuleConditionType,
    AnomalyEvent,
    IncidentSeverity,
    IncidentTriggerType,
    Metric,
)
from app.redis_client import alerts_channel, publish_json
from app.schemas.alert_rule import AlertRuleRead, AlertRuleTestResponse
from app.services.incident_service import IncidentService
from app.services.push_service import push_service

logger = logging.getLogger(__name__)


class AlertEvaluator:
    async def evaluate_all(self, org_id: uuid.UUID) -> int:
        async with async_session_factory() as session:
            rules = (
                await session.scalars(
                    select(AlertRule)
                    .where(
                        AlertRule.org_id == org_id,
                        AlertRule.is_enabled.is_(True),
                    )
                    .order_by(AlertRule.created_at.asc())
                )
            ).all()

            fired_count = 0
            for rule in rules:
                fired, _, _ = await self.evaluate_rule(session, rule, org_id)
                if fired:
                    fired_count += 1
            return fired_count

    async def evaluate_rule(
        self,
        session: AsyncSession,
        rule: AlertRule,
        org_id: uuid.UUID,
        *,
        dry_run: bool = False,
    ) -> tuple[bool, list[uuid.UUID], str]:
        matching_agents, reason = await self._preview_rule(session, rule, org_id)
        if not matching_agents:
            return False, [], reason

        if not dry_run and not _cooldown_elapsed(rule):
            return False, [], "Cooldown window active."

        if dry_run:
            return True, matching_agents, reason

        for agent_id in matching_agents:
            await self.fire_alert(
                session=session,
                rule=rule,
                org_id=org_id,
                agent_id=agent_id,
                context={"reason": reason},
            )

        rule.last_fired_at = datetime.now(timezone.utc)
        await session.commit()
        return True, matching_agents, reason

    async def fire_alert(
        self,
        session: AsyncSession,
        rule: AlertRule,
        org_id: uuid.UUID,
        agent_id: uuid.UUID,
        context: dict[str, Any],
    ) -> None:
        agent = await session.scalar(
            select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id)
        )
        if agent is None:
            return

        incident = await IncidentService.get_open_incident_for_agent(session, org_id, agent_id)
        event = {
            "event_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": "alert_fired",
            "title": f"Alert fired: {rule.name}",
            "detail": str(context.get("reason", rule.name)),
            "metric_snapshot": None,
            "severity": rule.severity.value,
        }
        if incident is None:
            await IncidentService.create_incident(
                session=session,
                org_id=org_id,
                agent_id=agent_id,
                trigger_type=IncidentTriggerType.ALERT.value,
                trigger_id=rule.id,
                severity=rule.severity,
                initial_event=event,
                title=f"{rule.name} on {agent.hostname}",
            )
        else:
            await IncidentService.append_event(
                session=session,
                incident_id=incident.id,
                org_id=org_id,
                event=event,
            )

        payload = {
            "rule_id": str(rule.id),
            "rule_name": rule.name,
            "org_id": str(org_id),
            "agent_id": str(agent_id),
            "severity": rule.severity.value,
            "context": context,
        }
        await self._send_channels(rule.channels_json or [], payload)
        await push_service.send_alert(
            session=session,
            org_id=org_id,
            title=f"{rule.severity.value.upper()} alert: {rule.name}",
            body=f"{agent.hostname}: {context.get('reason', rule.name)}",
        )
        await publish_json(alerts_channel(org_id), payload)

    async def get_active_org_ids(self, active_within_minutes: int = 5) -> list[uuid.UUID]:
        threshold = datetime.now(timezone.utc) - timedelta(minutes=active_within_minutes)
        async with async_session_factory() as session:
            rows = (
                await session.scalars(
                    select(Metric.org_id)
                    .distinct()
                    .join(
                        AlertRule,
                        (AlertRule.org_id == Metric.org_id) & AlertRule.is_enabled.is_(True),
                    )
                    .where(Metric.time >= threshold)
                )
            ).all()
        return list(rows)

    async def preview_rule(
        self,
        session: AsyncSession,
        rule: AlertRule,
        org_id: uuid.UUID,
    ) -> AlertRuleTestResponse:
        would_fire, matching_agents, reason = await self.evaluate_rule(
            session,
            rule,
            org_id,
            dry_run=True,
        )
        return AlertRuleTestResponse(
            would_fire=would_fire,
            matching_agents=matching_agents,
            reason=reason,
        )

    async def _preview_rule(
        self,
        session: AsyncSession,
        rule: AlertRule,
        org_id: uuid.UUID,
    ) -> tuple[list[uuid.UUID], str]:
        if rule.condition_type == AlertRuleConditionType.THRESHOLD:
            return await _evaluate_threshold_rule(session, rule, org_id)
        if rule.condition_type == AlertRuleConditionType.RELATIVE:
            return await _evaluate_relative_rule(session, rule, org_id)
        if rule.condition_type == AlertRuleConditionType.COMPOSITE:
            return await _evaluate_composite_rule(session, rule, org_id)
        if rule.condition_type == AlertRuleConditionType.ANOMALY_SCORE:
            return await _evaluate_anomaly_score_rule(session, rule, org_id)
        return [], "Unsupported rule type."

    async def _send_channels(
        self,
        channels: list[dict[str, Any]],
        payload: dict[str, Any],
    ) -> None:
        if not channels:
            return

        async with httpx.AsyncClient(timeout=10.0) as client:
            for channel in channels:
                channel_type = str(channel.get("type", "")).lower()
                try:
                    if channel_type == "email":
                        logger.info("Alert email to %s | %s", channel.get("address"), payload)
                    elif channel_type in {"slack", "discord"}:
                        webhook_url = channel.get("webhook_url")
                        if isinstance(webhook_url, str) and webhook_url:
                            await client.post(webhook_url, json={"text": _format_channel_message(payload)})
                    elif channel_type == "webhook":
                        url = channel.get("url")
                        method = str(channel.get("method", "POST")).upper()
                        if isinstance(url, str) and url:
                            await client.request(method, url, json=payload)
                except Exception:
                    logger.exception("Failed sending alert via %s channel", channel_type)


async def _evaluate_threshold_rule(
    session: AsyncSession,
    rule: AlertRule,
    org_id: uuid.UUID,
) -> tuple[list[uuid.UUID], str]:
    condition = rule.condition_json or {}
    metric_name = str(condition.get("metric", ""))
    operator = str(condition.get("operator", ">"))
    threshold_value = float(condition.get("value", 0))
    duration_minutes = max(1, int(condition.get("duration_minutes", 5)))
    window_start = datetime.now(timezone.utc) - timedelta(minutes=duration_minutes)
    metric_column = _metric_column(metric_name)
    if metric_column is None:
        return [], "Invalid metric."

    rows = (
        await session.execute(
            select(Metric.agent_id, metric_column)
            .where(
                Metric.org_id == org_id,
                Metric.time >= window_start,
            )
            .order_by(Metric.agent_id.asc(), Metric.time.asc())
        )
    ).all()

    values_by_agent: dict[uuid.UUID, list[float]] = defaultdict(list)
    for row in rows:
        values_by_agent[row.agent_id].append(float(row[1]))

    matching_agents = [
        agent_id
        for agent_id, values in values_by_agent.items()
        if values and all(_compare(value, operator, threshold_value) for value in values)
    ]
    return matching_agents, f"{metric_name} stayed {operator} {threshold_value} for {duration_minutes} minutes."


async def _evaluate_relative_rule(
    session: AsyncSession,
    rule: AlertRule,
    org_id: uuid.UUID,
) -> tuple[list[uuid.UUID], str]:
    condition = rule.condition_json or {}
    metric_name = str(condition.get("metric", ""))
    operator = str(condition.get("operator", ">"))
    percent_change = float(condition.get("percent_change", 0))
    baseline_hours = max(1, int(condition.get("baseline_hours", 24)))
    metric_column = _metric_column(metric_name)
    if metric_column is None:
        return [], "Invalid metric."

    now = datetime.now(timezone.utc)
    recent_start = now - timedelta(minutes=5)
    baseline_start = now - timedelta(hours=baseline_hours)

    rows = (
        await session.execute(
            select(
                Metric.agent_id,
                func.avg(metric_column).filter(Metric.time >= recent_start).label("recent_avg"),
                func.avg(metric_column)
                .filter(Metric.time >= baseline_start, Metric.time < recent_start)
                .label("baseline_avg"),
            )
            .where(
                Metric.org_id == org_id,
                Metric.time >= baseline_start,
            )
            .group_by(Metric.agent_id)
        )
    ).all()

    matching_agents: list[uuid.UUID] = []
    for row in rows:
        recent_avg = float(row.recent_avg or 0.0)
        baseline_avg = float(row.baseline_avg or 0.0)
        if baseline_avg <= 0:
            continue
        change = ((recent_avg - baseline_avg) / baseline_avg) * 100.0
        if _compare(change, operator, percent_change):
            matching_agents.append(row.agent_id)

    return matching_agents, f"{metric_name} changed {operator} {percent_change:.1f}% versus {baseline_hours}h baseline."


async def _evaluate_composite_rule(
    session: AsyncSession,
    rule: AlertRule,
    org_id: uuid.UUID,
) -> tuple[list[uuid.UUID], str]:
    condition = rule.condition_json or {}
    join_operator = str(condition.get("operator", "AND")).upper()
    conditions = condition.get("conditions")
    if not isinstance(conditions, list) or not conditions:
        return [], "Composite rule has no conditions."

    window_start = datetime.now(timezone.utc) - timedelta(minutes=5)
    rows = (
        await session.execute(
            select(
                Metric.agent_id,
                func.avg(Metric.cpu).label("cpu_percent"),
                func.avg(Metric.memory).label("memory_percent"),
                func.avg(Metric.disk).label("disk_percent"),
            )
            .where(
                Metric.org_id == org_id,
                Metric.time >= window_start,
            )
            .group_by(Metric.agent_id)
        )
    ).all()

    matching_agents: list[uuid.UUID] = []
    for row in rows:
        values = {
            "cpu_percent": float(row.cpu_percent or 0.0),
            "memory_percent": float(row.memory_percent or 0.0),
            "disk_percent": float(row.disk_percent or 0.0),
        }
        evaluations = []
        for item in conditions:
            if not isinstance(item, dict):
                continue
            metric_name = str(item.get("metric", ""))
            operator = str(item.get("operator", ">"))
            target = float(item.get("value", 0))
            evaluations.append(_compare(values.get(metric_name, 0.0), operator, target))

        if evaluations and ((join_operator == "AND" and all(evaluations)) or (join_operator == "OR" and any(evaluations))):
            matching_agents.append(row.agent_id)

    return matching_agents, f"Composite rule matched using {join_operator}."


async def _evaluate_anomaly_score_rule(
    session: AsyncSession,
    rule: AlertRule,
    org_id: uuid.UUID,
) -> tuple[list[uuid.UUID], str]:
    condition = rule.condition_json or {}
    min_score = float(condition.get("min_score", 0.0))
    reasons = {
        str(reason)
        for reason in condition.get("reasons", [])
        if isinstance(reason, str)
    }
    window_start = datetime.now(timezone.utc) - timedelta(minutes=30)
    rows = (
        await session.scalars(
            select(AnomalyEvent)
            .where(
                AnomalyEvent.org_id == org_id,
                AnomalyEvent.created_at >= window_start,
                AnomalyEvent.score >= min_score,
            )
            .order_by(AnomalyEvent.created_at.desc())
        )
    ).all()

    matching_agents = [
        row.agent_id
        for row in rows
        if not reasons or row.reason in reasons
    ]
    deduped = list(dict.fromkeys(matching_agents))
    return deduped, f"Recent anomalies exceeded score {min_score:.2f}."


def _metric_column(metric_name: str):
    return {
        "cpu_percent": Metric.cpu,
        "memory_percent": Metric.memory,
        "disk_percent": Metric.disk,
    }.get(metric_name)


def _compare(left: float, operator: str, right: float) -> bool:
    if operator == ">":
        return left > right
    if operator == "<":
        return left < right
    if operator == ">=":
        return left >= right
    if operator == "<=":
        return left <= right
    return False


def _cooldown_elapsed(rule: AlertRule) -> bool:
    if rule.last_fired_at is None:
        return True
    return (datetime.now(timezone.utc) - rule.last_fired_at) >= timedelta(minutes=rule.cooldown_minutes)


def _format_channel_message(payload: dict[str, Any]) -> str:
    return (
        f"[{payload.get('severity', 'info').upper()}] {payload.get('rule_name', 'SysPulse alert')} "
        f"for agent {payload.get('agent_id')} | {payload.get('context', {}).get('reason', '')}"
    )


alert_evaluator = AlertEvaluator()
