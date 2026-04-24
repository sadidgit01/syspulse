import asyncio
import json
import logging
from collections import defaultdict
from contextlib import suppress
from typing import Any
from uuid import UUID

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from app.redis_client import create_pubsub, metrics_channel

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._listeners: dict[UUID, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, org_id: UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[org_id].add(websocket)
            if org_id not in self._listeners:
                self._listeners[org_id] = asyncio.create_task(self._listen(org_id))
        await websocket.send_json({"status": "connected", "org_id": str(org_id)})

    async def disconnect(self, org_id: UUID, websocket: WebSocket) -> None:
        listener_to_cancel: asyncio.Task[None] | None = None

        async with self._lock:
            connections = self._connections.get(org_id)
            if connections and websocket in connections:
                connections.remove(websocket)
            if connections is not None and not connections:
                self._connections.pop(org_id, None)
                listener_to_cancel = self._listeners.pop(org_id, None)

        if listener_to_cancel is not None:
            listener_to_cancel.cancel()
            with suppress(asyncio.CancelledError):
                await listener_to_cancel

        if websocket.client_state != WebSocketState.DISCONNECTED:
            with suppress(RuntimeError):
                await websocket.close()

    async def broadcast(self, org_id: UUID, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._connections.get(org_id, set()))

        disconnected: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_json(payload)
            except Exception:
                disconnected.append(websocket)

        for websocket in disconnected:
            await self.disconnect(org_id, websocket)

    async def shutdown(self) -> None:
        async with self._lock:
            listeners = list(self._listeners.values())
            connections = [socket for sockets in self._connections.values() for socket in sockets]
            self._listeners.clear()
            self._connections.clear()

        for listener in listeners:
            listener.cancel()
        for listener in listeners:
            with suppress(asyncio.CancelledError):
                await listener
        for websocket in connections:
            if websocket.client_state != WebSocketState.DISCONNECTED:
                with suppress(RuntimeError):
                    await websocket.close(code=1001)

    async def _listen(self, org_id: UUID) -> None:
        channel = metrics_channel(org_id)
        while True:
            pubsub = await create_pubsub()
            try:
                await pubsub.subscribe(channel)
                while True:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True,
                        timeout=1.0,
                    )
                    if message is None:
                        await asyncio.sleep(0.05)
                        continue

                    raw_payload = message.get("data")
                    if raw_payload is None:
                        continue
                    if isinstance(raw_payload, bytes):
                        raw_payload = raw_payload.decode("utf-8")

                    payload = json.loads(raw_payload)
                    await self.broadcast(org_id, payload)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Redis subscription failed for org %s", org_id)
                await asyncio.sleep(1)
            finally:
                with suppress(Exception):
                    await pubsub.unsubscribe(channel)
                with suppress(Exception):
                    await pubsub.aclose()


ws_manager = WebSocketManager()
