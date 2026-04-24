from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime
from typing import Any

from groq import Groq

from app.config import get_settings

logger = logging.getLogger(__name__)

MODEL_NAME = "meta-llama/llama-4-scout-17b-16e-instruct"
MAX_INPUT_CHARS = 2000
MAX_OUTPUT_TOKENS = 200
DEFAULT_EXPLANATION = "Explanation unavailable."

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

    def answer_query(
        self,
        org_id: str,
        question: str,
        context_data: dict[str, Any],
    ) -> str:
        del org_id
        try:
            context = _truncate_text(
                json.dumps(context_data, default=str, separators=(",", ":")),
                MAX_INPUT_CHARS,
            )
            user_prompt = _truncate_text(
                f"Context: {context}\nQuestion: {question.strip()}",
                MAX_INPUT_CHARS,
            )
            return self._complete(
                system_prompt=(
                    "You are SysPulse AI assistant. Answer questions about the user's infrastructure "
                    "based only on the provided context. If the answer is not in context, say so. "
                    "Be concise. No markdown."
                ),
                user_prompt=user_prompt,
            )
        except Exception:
            logger.exception("Failed to answer AI query.")
            return DEFAULT_EXPLANATION

    def _complete(self, *, system_prompt: str, user_prompt: str) -> str:
        client = self._get_client()
        if client is None:
            return DEFAULT_EXPLANATION

        try:
            completion = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": _truncate_text(system_prompt, 600)},
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


def _truncate_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 3)].rstrip() + "..."


llm_explainer = LLMExplainer()
