from __future__ import annotations

import asyncio
from typing import Sequence

import httpx

from collector import LogEntry, MetricSnapshot


class SysPulseShipper:
    def __init__(self, server_url: str, agent_token: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=server_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {agent_token}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(10.0, connect=5.0),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def ship_metrics(self, metrics: Sequence[MetricSnapshot]) -> int:
        payload = [metric.as_payload() for metric in metrics]
        return await self._post_with_retry("/ingest/metrics", payload)

    async def ship_logs(self, logs: Sequence[LogEntry]) -> int:
        payload = [entry.as_payload() for entry in logs]
        return await self._post_with_retry("/ingest/logs", payload)

    async def _post_with_retry(self, path: str, payload: list[dict[str, object]]) -> int:
        delay_seconds = 1.0
        last_error: Exception | None = None

        for attempt in range(1, 4):
            try:
                response = await self._client.post(path, json=payload)
                response.raise_for_status()
                return response.status_code
            except (httpx.HTTPError, httpx.TimeoutException) as exc:
                last_error = exc
                if attempt == 3:
                    break
                await asyncio.sleep(delay_seconds)
                delay_seconds *= 2

        if last_error is None:
            raise RuntimeError("Metric shipment failed for an unknown reason.")
        raise RuntimeError(f"Failed to POST {path}: {last_error}") from last_error
