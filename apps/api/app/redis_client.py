import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from redis.asyncio import Redis
from redis.asyncio.client import PubSub

from app.config import get_settings

settings = get_settings()
_redis_client: Redis | None = None


async def get_redis() -> Redis:
    global _redis_client

    if _redis_client is None:
        _redis_client = Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


def metrics_channel(org_id: UUID | str) -> str:
    return f"metrics:{org_id}"


def logs_channel(org_id: UUID | str) -> str:
    return f"logs:{org_id}"


def alerts_candidates_channel(org_id: UUID | str) -> str:
    return f"alerts:candidates:{org_id}"


def correlation_channel(org_id: UUID | str) -> str:
    return f"correlation:{org_id}"


def anomalies_channel(org_id: UUID | str) -> str:
    return f"anomalies:{org_id}"


def forecasts_channel(org_id: UUID | str) -> str:
    return f"forecasts:{org_id}"


def ai_query_rate_limit_key(user_id: UUID | str) -> str:
    return f"ai_query:rate_limit:{user_id}"


async def ping_redis() -> bool:
    try:
        client = await get_redis()
        return bool(await client.ping())
    except Exception:
        return False


async def publish_json(channel: str, payload: dict[str, Any]) -> None:
    client = await get_redis()
    await client.publish(channel, json.dumps(payload, default=str))


async def create_pubsub() -> PubSub:
    client = await get_redis()
    return client.pubsub()


def used_refresh_token_key(jti: str) -> str:
    return f"refresh_token:used:{jti}"


async def mark_refresh_token_used(jti: str, expires_at: datetime) -> None:
    client = await get_redis()
    ttl = max(1, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
    await client.set(used_refresh_token_key(jti), "1", ex=ttl)


async def is_refresh_token_used(jti: str) -> bool:
    client = await get_redis()
    return bool(await client.exists(used_refresh_token_key(jti)))


async def close_redis() -> None:
    global _redis_client

    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
