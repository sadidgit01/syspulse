from __future__ import annotations

import hashlib
import os
import subprocess
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import psutil


@dataclass(frozen=True)
class MetricSnapshot:
    timestamp: str
    cpu_percent: float
    memory_percent: float
    disk_percent: float
    net_bytes_in: float
    net_bytes_out: float

    def as_payload(self) -> dict[str, float | str]:
        return asdict(self)


@dataclass(frozen=True)
class LogEntry:
    timestamp: str
    level: str
    source: str
    message: str

    def as_payload(self) -> dict[str, str]:
        return asdict(self)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


class MetricsCollector:
    def __init__(self) -> None:
        self._disk_path = self._resolve_disk_path()
        self._previous_net = psutil.net_io_counters()
        psutil.cpu_percent(interval=None)

    @staticmethod
    def _resolve_disk_path() -> str:
        if os.name == "nt":
            return f"{os.environ.get('SystemDrive', 'C:')}\\"
        return "/"

    def collect(self) -> MetricSnapshot:
        current_net = psutil.net_io_counters()
        bytes_recv_delta = max(0, current_net.bytes_recv - self._previous_net.bytes_recv)
        bytes_sent_delta = max(0, current_net.bytes_sent - self._previous_net.bytes_sent)
        self._previous_net = current_net

        return MetricSnapshot(
            timestamp=_isoformat(_utc_now()),
            cpu_percent=float(psutil.cpu_percent(interval=None)),
            memory_percent=float(psutil.virtual_memory().percent),
            disk_percent=float(psutil.disk_usage(self._disk_path).percent),
            net_bytes_in=float(bytes_recv_delta),
            net_bytes_out=float(bytes_sent_delta),
        )


class LogCollector:
    def __init__(self) -> None:
        self._platform = "windows" if os.name == "nt" else "linux"
        self._syslog_path = self._resolve_syslog_path()
        self._syslog_offset = 0
        self._syslog_inode: int | None = None
        self._seen_windows_entries: deque[str] = deque(maxlen=200)
        self._seen_windows_entry_set: set[str] = set()

    def collect(self, limit: int = 20) -> list[LogEntry]:
        if self._platform == "windows":
            return self._collect_windows_event_logs(limit=limit)
        return self._collect_linux_logs(limit=limit)

    @staticmethod
    def _resolve_syslog_path() -> Path | None:
        for candidate in ("/var/log/syslog", "/var/log/messages"):
            path = Path(candidate)
            if path.exists():
                return path
        return None

    def _collect_linux_logs(self, limit: int) -> list[LogEntry]:
        if self._syslog_path is None or not self._syslog_path.exists():
            return []

        stat_result = self._syslog_path.stat()
        inode = getattr(stat_result, "st_ino", None)
        if self._syslog_inode is None or self._syslog_inode != inode or stat_result.st_size < self._syslog_offset:
            self._syslog_offset = 0
            self._syslog_inode = inode

        with self._syslog_path.open("r", encoding="utf-8", errors="ignore") as handle:
            handle.seek(self._syslog_offset)
            new_content = handle.read()
            self._syslog_offset = handle.tell()

        lines = [line.strip() for line in new_content.splitlines() if line.strip()]
        return [self._parse_linux_line(line) for line in lines[-limit:]]

    def _parse_linux_line(self, line: str) -> LogEntry:
        timestamp = _isoformat(self._parse_linux_timestamp(line))
        level = self._infer_level(line)

        remainder = line
        if len(line) > 16:
            remainder = line[16:].strip()

        source = "syslog"
        if ":" in remainder:
            source = remainder.split(":", 1)[0].split()[-1]

        return LogEntry(
            timestamp=timestamp,
            level=level,
            source=source,
            message=line,
        )

    @staticmethod
    def _parse_linux_timestamp(line: str) -> datetime:
        try:
            raw = f"{datetime.now().year} {line[:15]}"
            return datetime.strptime(raw, "%Y %b %d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            return _utc_now()

    def _collect_windows_event_logs(self, limit: int) -> list[LogEntry]:
        try:
            result = subprocess.run(
                ["wevtutil", "qe", "System", f"/c:{limit}", "/rd:true", "/f:text"],
                capture_output=True,
                check=False,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
        except OSError:
            return []

        if result.returncode != 0 or not result.stdout.strip():
            return []

        blocks = [block.strip() for block in result.stdout.split("\n\n") if block.strip()]
        unseen_entries: list[LogEntry] = []

        for block in reversed(blocks):
            fingerprint = hashlib.sha256(block.encode("utf-8")).hexdigest()
            if fingerprint in self._seen_windows_entry_set:
                continue

            self._remember_windows_fingerprint(fingerprint)
            unseen_entries.append(self._parse_windows_block(block))

        return unseen_entries[-limit:]

    def _remember_windows_fingerprint(self, fingerprint: str) -> None:
        if len(self._seen_windows_entries) == self._seen_windows_entries.maxlen:
            oldest = self._seen_windows_entries.popleft()
            self._seen_windows_entry_set.discard(oldest)

        self._seen_windows_entries.append(fingerprint)
        self._seen_windows_entry_set.add(fingerprint)

    def _parse_windows_block(self, block: str) -> LogEntry:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        data = self._extract_windows_fields(lines)
        timestamp = self._parse_windows_timestamp(data.get("Date", ""))

        return LogEntry(
            timestamp=_isoformat(timestamp),
            level=self._map_windows_level(data.get("Level", "")),
            source=data.get("Provider Name", "Windows Event Log"),
            message=block,
        )

    @staticmethod
    def _extract_windows_fields(lines: Iterable[str]) -> dict[str, str]:
        fields: dict[str, str] = {}
        for line in lines:
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
        return fields

    @staticmethod
    def _parse_windows_timestamp(raw: str) -> datetime:
        if not raw:
            return _utc_now()

        candidates = [
            raw,
            raw.replace("Z", "+00:00"),
        ]
        for candidate in candidates:
            try:
                parsed = datetime.fromisoformat(candidate)
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=timezone.utc)
                return parsed.astimezone(timezone.utc)
            except ValueError:
                continue
        return _utc_now()

    @staticmethod
    def _map_windows_level(level: str) -> str:
        normalized = level.upper()
        if "CRITICAL" in normalized:
            return "CRITICAL"
        if "ERROR" in normalized:
            return "ERROR"
        if "WARNING" in normalized:
            return "WARNING"
        if "DEBUG" in normalized or "VERBOSE" in normalized:
            return "DEBUG"
        return "INFO"

    @staticmethod
    def _infer_level(message: str) -> str:
        normalized = message.upper()
        if "CRITICAL" in normalized or "FATAL" in normalized:
            return "CRITICAL"
        if "ERROR" in normalized or "ERR" in normalized:
            return "ERROR"
        if "WARNING" in normalized or "WARN" in normalized:
            return "WARNING"
        if "DEBUG" in normalized:
            return "DEBUG"
        return "INFO"
