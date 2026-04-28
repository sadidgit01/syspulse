from collections.abc import Awaitable
from typing import TypeVar

import asyncio

from app.database import close_database

T = TypeVar("T")


def run_async_task(awaitable: Awaitable[T]) -> T:
    async def runner() -> T:
        try:
            return await awaitable
        finally:
            await close_database()

    return asyncio.run(runner())
