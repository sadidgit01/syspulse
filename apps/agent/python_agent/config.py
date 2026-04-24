from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    syspulse_server: str
    agent_token: str
    interval: int


def load_settings() -> Settings:
    server = os.getenv("SYSPULSE_SERVER", "").strip().rstrip("/")
    token = os.getenv("AGENT_TOKEN", "").strip()
    interval_raw = os.getenv("INTERVAL", "5").strip()

    if not server:
        raise ValueError("SYSPULSE_SERVER is required.")
    if not token:
        raise ValueError("AGENT_TOKEN is required.")

    try:
        interval = int(interval_raw)
    except ValueError as exc:
        raise ValueError("INTERVAL must be an integer.") from exc

    if interval <= 0:
        raise ValueError("INTERVAL must be greater than 0.")

    return Settings(
        syspulse_server=server,
        agent_token=token,
        interval=interval,
    )
