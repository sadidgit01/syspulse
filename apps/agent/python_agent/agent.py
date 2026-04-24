from __future__ import annotations

import asyncio
import signal
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

from collector import LogCollector, LogEntry, MetricSnapshot, MetricsCollector
from config import Settings, load_settings
from shipper import SysPulseShipper

METRIC_BATCH_SIZE = 6
LOG_INTERVAL_SECONDS = 60


def log(message: str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    print(f"{timestamp} | {message}", flush=True)


async def flush_metric_batch(
    shipper: SysPulseShipper,
    pending_metrics: list[MetricSnapshot],
    force_flush: bool = False,
) -> None:
    while pending_metrics and (force_flush or len(pending_metrics) >= METRIC_BATCH_SIZE):
        batch_size = len(pending_metrics) if force_flush and len(pending_metrics) < METRIC_BATCH_SIZE else METRIC_BATCH_SIZE
        batch = pending_metrics[:batch_size]
        status_code = await shipper.ship_metrics(batch)
        average_cpu = sum(snapshot.cpu_percent for snapshot in batch) / len(batch)
        log(
            f"Shipped {len(batch)} metrics | CPU avg: {average_cpu:.0f}% | Status: {status_code}"
        )
        del pending_metrics[:batch_size]


async def flush_logs(shipper: SysPulseShipper, logs: list[LogEntry]) -> None:
    if not logs:
        return

    status_code = await shipper.ship_logs(logs)
    log(f"Shipped {len(logs)} logs | Status: {status_code}")


def install_signal_handlers(stop_callback: Callable[[], None]) -> None:
    def _handle_signal(_: int, __) -> None:
        stop_callback()

    for signal_name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, signal_name, None)
        if sig is None:
            continue
        try:
            signal.signal(sig, _handle_signal)
        except (ValueError, OSError):
            continue


async def run(settings: Settings) -> None:
    metrics_collector = MetricsCollector()
    log_collector = LogCollector()
    shipper = SysPulseShipper(
        server_url=settings.syspulse_server,
        agent_token=settings.agent_token,
    )
    stop_event = asyncio.Event()
    install_signal_handlers(stop_event.set)

    pending_metrics: list[MetricSnapshot] = []
    next_log_flush = asyncio.get_running_loop().time() + LOG_INTERVAL_SECONDS

    try:
        log(
            f"Agent started | Server: {settings.syspulse_server} | Interval: {settings.interval}s"
        )
        while not stop_event.is_set():
            pending_metrics.append(metrics_collector.collect())

            if len(pending_metrics) >= METRIC_BATCH_SIZE:
                try:
                    await flush_metric_batch(shipper, pending_metrics)
                except Exception as exc:
                    log(f"Metric shipment failed | Reason: {exc}")

            now = asyncio.get_running_loop().time()
            if now >= next_log_flush:
                try:
                    logs = log_collector.collect(limit=20)
                    await flush_logs(shipper, logs)
                except Exception as exc:
                    log(f"Log shipment failed | Reason: {exc}")
                finally:
                    next_log_flush = now + LOG_INTERVAL_SECONDS

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=settings.interval)
            except asyncio.TimeoutError:
                continue
    finally:
        try:
            await flush_metric_batch(shipper, pending_metrics, force_flush=True)
        except Exception as exc:
            log(f"Final metric flush failed | Reason: {exc}")

        try:
            await flush_logs(shipper, log_collector.collect(limit=20))
        except Exception as exc:
            log(f"Final log flush failed | Reason: {exc}")

        await shipper.close()
        log("Agent stopped")


def main() -> None:
    settings = load_settings()
    asyncio.run(run(settings))


if __name__ == "__main__":
    main()
