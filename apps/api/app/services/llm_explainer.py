from __future__ import annotations

import json
import logging
from time import perf_counter
from collections import Counter
from datetime import datetime
from typing import Any

from groq import Groq
from opentelemetry import trace

from app.config import get_settings

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

MODEL_NAME = "meta-llama/llama-4-scout-17b-16e-instruct"
MAX_INPUT_CHARS = 10000
MAX_SYSTEM_PROMPT_CHARS = 3000
MAX_OUTPUT_TOKENS = 320
DEFAULT_EXPLANATION = "Explanation unavailable."
SYS_PULSE_QUERY_SYSTEM_PROMPT = """
You are SysPulse, an expert infrastructure monitoring AI assistant
with deep knowledge of Linux systems, DevOps, performance engineering,
and site reliability engineering.

You have real-time access to the user's infrastructure data:
- Live metrics from all their servers
- Recent error logs
- AI-detected anomalies
- Predictive forecasts
- Active incidents

Your personality:
- Direct and confident, like a senior SRE who has seen everything
- You use exact numbers from the context, never vague estimates
- You explain WHY something is happening, not just what
- You give actionable advice when something looks wrong
- You can handle casual conversation but always bring it back to
  infrastructure insight when relevant
- You never say "I don't have context" -- you always work with what
  you have and say what you can and cannot determine

Response rules:
- For greetings: respond warmly and give a 1-line health summary
  e.g. "Hey! Your fleet looks healthy right now -- 1 node online,
  CPU at 23%, memory at 86%. What do you want to dig into?"
- For metric questions: use exact numbers, explain trends
- For "is everything ok": give the health score + brief summary
- For anomaly questions: reference actual anomaly events if any
- For advice questions: give specific, actionable SRE advice
- Keep responses under 150 words unless asked for detail
- Never use bullet points unless the user asks for a list
- Never say "based on the context provided" -- just answer naturally
""".strip()

settings = get_settings()


class LLMExplainer:
    def __init__(self) -> None:
        self._client: Groq | None = None

    def explain_anomaly(
        self,
        anomaly_event: dict[str, Any],
        recent_metrics: list[dict[str, Any]],
        recent_logs: list[dict[str, Any]],
    ) -> str:
        try:
            context = _build_anomaly_context(
                anomaly_event=anomaly_event,
                recent_metrics=recent_metrics,
                recent_logs=recent_logs,
            )
            return self._complete(
                system_prompt=(
                    "You are SysPulse, an infrastructure monitoring AI. "
                    "A metric anomaly was detected. Based on the context, provide a 2-3 sentence "
                    "plain-English explanation of what likely happened and what the operator should check. "
                    "Be specific. No markdown. No bullet points. No hedging phrases."
                ),
                user_prompt=context,
            )
        except Exception:
            logger.exception("Failed to explain anomaly event.")
            return DEFAULT_EXPLANATION

    def explain_forecast(self, forecast_alert: dict[str, Any]) -> str:
        try:
            hostname = str(forecast_alert.get("hostname", "unknown-agent"))
            metric = str(forecast_alert.get("metric", "metric"))
            current = float(forecast_alert.get("current_value", 0.0))
            hours = forecast_alert.get("exceed_in_hours")
            hours_text = "unknown time" if hours is None else f"{float(hours):.1f}h"
            context = (
                f"Agent {hostname}. {metric} currently at {current:.1f}%. "
                f"Predicted to reach 90% in {hours_text} based on recent trend."
            )
            return self._complete(
                system_prompt=(
                    "You are SysPulse, an infrastructure monitoring AI. "
                    "A forecast alert was detected. Based on the context, provide a 1-2 sentence "
                    "plain-English warning of what is likely happening and what the operator should check. "
                    "Be specific. No markdown. No bullet points. No hedging phrases."
                ),
                user_prompt=context,
            )
        except Exception:
            logger.exception("Failed to explain forecast alert.")
            return DEFAULT_EXPLANATION

    def explain_incident(
        self,
        incident: dict[str, Any],
        timeline_events: list[dict[str, Any]],
    ) -> str:
        try:
            compact_timeline = _truncate_text(
                json.dumps(timeline_events[:40], default=str, separators=(",", ":")),
                MAX_INPUT_CHARS,
            )
            context = (
                f"Incident {incident.get('title', 'incident')} on {incident.get('hostname', 'unknown-agent')}. "
                f"Severity {incident.get('severity', 'unknown')}, status {incident.get('status', 'unknown')}. "
                f"Timeline: {compact_timeline}"
            )
            return self._complete(
                system_prompt=(
                    "You are SysPulse, an infrastructure monitoring AI. "
                    "Summarize this incident timeline in 2-3 sentences, focusing on what happened, "
                    "what signals appeared first, and what the operator should pay attention to next. "
                    "No markdown. No bullet points."
                ),
                user_prompt=context,
            )
        except Exception:
            logger.exception("Failed to explain incident timeline.")
            return DEFAULT_EXPLANATION

    def answer_query(
        self,
        org_id: str,
        question: str,
        context_data: dict[str, Any],
    ) -> str:
        del org_id
        try:
            return self._complete(
                system_prompt=SYS_PULSE_QUERY_SYSTEM_PROMPT,
                user_prompt=_build_query_user_message(context_data=context_data, question=question),
            )
        except Exception:
            logger.exception("Failed to answer AI query.")
            return DEFAULT_EXPLANATION

    def _complete(self, *, system_prompt: str, user_prompt: str) -> str:
        input_tokens = _estimate_tokens(system_prompt) + _estimate_tokens(user_prompt)
        start_time = perf_counter()
        with tracer.start_as_current_span("ai.llm_explain") as span:
            span.set_attribute("model", MODEL_NAME)
            span.set_attribute("input_tokens", input_tokens)
            try:
                client = self._get_client()
                if client is None:
                    return DEFAULT_EXPLANATION

                completion = client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=[
                        {
                            "role": "system",
                            "content": _truncate_text(system_prompt, MAX_SYSTEM_PROMPT_CHARS),
                        },
                        {"role": "user", "content": _truncate_text(user_prompt, MAX_INPUT_CHARS)},
                    ],
                    temperature=0.2,
                    max_completion_tokens=MAX_OUTPUT_TOKENS,
                )
                content = completion.choices[0].message.content if completion.choices else None
                if not content:
                    return DEFAULT_EXPLANATION
                return _truncate_text(content.strip().replace("\n", " "), 900)
            except Exception:
                logger.exception("Groq completion request failed.")
                return DEFAULT_EXPLANATION
            finally:
                span.set_attribute("duration_ms", round((perf_counter() - start_time) * 1000, 3))

    def _get_client(self) -> Groq | None:
        if not settings.groq_api_key:
            return None
        if self._client is None:
            self._client = Groq(api_key=settings.groq_api_key)
        return self._client


def _build_anomaly_context(
    *,
    anomaly_event: dict[str, Any],
    recent_metrics: list[dict[str, Any]],
    recent_logs: list[dict[str, Any]],
) -> str:
    hostname = str(anomaly_event.get("hostname", "unknown-agent"))
    event_time = str(anomaly_event.get("time", anomaly_event.get("created_at", "")))
    reason = str(anomaly_event.get("reason", "unknown"))
    score = float(anomaly_event.get("score", 0.0))

    cpu_avg = _mean_metric(recent_metrics, "cpu_percent")
    memory_avg = _mean_metric(recent_metrics, "memory_percent")
    disk_avg = _mean_metric(recent_metrics, "disk_percent")
    top_messages = _top_log_messages(recent_logs)

    context = (
        f"Agent {hostname} at {event_time}. "
        f"Anomaly detected: {reason}, score {score:.2f}. "
        f"Recent metrics (last 5 min): CPU avg {cpu_avg:.1f}%, Memory avg {memory_avg:.1f}%, Disk {disk_avg:.1f}%. "
        f"Recent errors (last 5 min): {len(recent_logs)} error logs. "
        f"Top messages: {' | '.join(top_messages) if top_messages else 'none'}."
    )
    return _truncate_text(context, MAX_INPUT_CHARS)


def _mean_metric(metrics: list[dict[str, Any]], key: str) -> float:
    values = [float(metric.get(key, 0.0)) for metric in metrics]
    if not values:
        return 0.0
    return sum(values) / len(values)


def _top_log_messages(logs: list[dict[str, Any]]) -> list[str]:
    messages = [
        _truncate_text(str(log.get("message", "")).strip(), 120)
        for log in logs
        if str(log.get("message", "")).strip()
    ]
    if not messages:
        return []
    counts = Counter(messages)
    return [message for message, _ in counts.most_common(3)]


def _build_query_user_message(context_data: dict[str, Any], question: str) -> str:
    agents = context_data.get("agents", [])
    health = context_data.get("system_health", {})
    logs = context_data.get("logs", {})
    anomalies = context_data.get("anomalies", [])
    forecasts = context_data.get("forecasts", [])
    incidents = context_data.get("incidents", [])

    fleet_lines = "\n".join(_format_agent_line(agent) for agent in agents)
    error_lines = "\n".join(_format_error_line(log) for log in logs.get("recent", [])[:5])
    anomaly_lines = "\n".join(_format_anomaly_line(anomaly) for anomaly in anomalies)
    forecast_lines = "\n".join(_format_forecast_line(forecast) for forecast in forecasts)
    incident_lines = "\n".join(_format_incident_line(incident) for incident in incidents)

    return _truncate_text(
        f"""
Current time: {context_data.get("current_time", datetime.utcnow().isoformat())}

FLEET STATUS:
{fleet_lines or "No agents registered"}

SYSTEM HEALTH SCORE: {health.get("score", 0)}/100 ({health.get("label", "Unknown")})
SYSTEM HEALTH ISSUES:
{_format_issues(health.get("issues", []))}

RECENT ERRORS ({logs.get("count_last_hour", 0)} in last hour):
{error_lines or "None detected"}

ACTIVE ANOMALIES:
{anomaly_lines or "None detected"}

ACTIVE FORECASTS:
{forecast_lines or "All metrics within safe range"}

OPEN INCIDENTS:
{incident_lines or "No active incidents"}

USER QUESTION: {question.strip()}
""".strip(),
        MAX_INPUT_CHARS,
    )


def _format_agent_line(agent: dict[str, Any]) -> str:
    metrics = agent.get("metrics", {})
    cpu = metrics.get("cpu_percent", {})
    memory = metrics.get("memory_percent", {})
    disk = metrics.get("disk_percent", {})
    return (
        f"Agent {agent.get('hostname', 'unknown-agent')} ({agent.get('os', 'unknown')}): "
        f"{agent.get('status', 'unknown')}, "
        f"CPU {_metric_value(cpu, 'current')}% (avg {_metric_value(cpu, 'average_60m')}%, "
        f"trend: {cpu.get('trend', 'unknown')}), "
        f"Memory {_metric_value(memory, 'current')}% (avg {_metric_value(memory, 'average_60m')}%, "
        f"trend: {memory.get('trend', 'unknown')}), "
        f"Disk {_metric_value(disk, 'current')}% "
        f"(avg {_metric_value(disk, 'average_60m')}%, trend: {disk.get('trend', 'unknown')}, "
        f"peak: {disk.get('peak_time', 'unknown')})"
    )


def _format_error_line(log: dict[str, Any]) -> str:
    message = _truncate_text(str(log.get("message", "")), 180)
    return (
        f"{log.get('timestamp', 'unknown')} | {log.get('agent', 'unknown-agent')} | "
        f"{log.get('level', 'ERROR')} | {log.get('source', 'unknown')}: {message}"
    )


def _format_anomaly_line(anomaly: dict[str, Any]) -> str:
    explanation = anomaly.get("explanation") or "No explanation generated yet"
    return (
        f"{anomaly.get('timestamp', 'unknown')} | {anomaly.get('agent', 'unknown-agent')} | "
        f"{anomaly.get('reason', 'unknown')} | score {anomaly.get('score', 0)} "
        f"({anomaly.get('severity', 'unknown')}): {_truncate_text(str(explanation), 180)}"
    )


def _format_forecast_line(forecast: dict[str, Any]) -> str:
    return (
        f"{forecast.get('agent', 'unknown-agent')} | {forecast.get('metric', 'metric')} "
        f"current {forecast.get('current_value', 'unknown')}%, predicted "
        f"{forecast.get('predicted_value', 'unknown')}%, exceeds 90 in "
        f"{forecast.get('exceed_in_hours', 'unknown')}h"
    )


def _format_incident_line(incident: dict[str, Any]) -> str:
    return (
        f"{incident.get('started_at', 'unknown')} | {incident.get('title', 'Incident')} | "
        f"{incident.get('severity', 'unknown')} | {incident.get('status', 'unknown')}"
    )


def _format_issues(issues: Any) -> str:
    if not isinstance(issues, list) or not issues:
        return "None"
    return "\n".join(str(issue) for issue in issues[:8])


def _metric_value(metric: dict[str, Any], key: str) -> str:
    value = metric.get(key)
    if value is None:
        return "unknown"
    return str(value)


def _truncate_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 3)].rstrip() + "..."


def _estimate_tokens(value: str) -> int:
    return max(1, len(value) // 4)


llm_explainer = LLMExplainer()
