import json
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


async def close_redis() -> None:
    global _redis_client

    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
