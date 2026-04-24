from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.ws_manager import ws_manager

router = APIRouter()


@router.websocket("/ws/{org_id}")
async def websocket_metrics(websocket: WebSocket, org_id: UUID) -> None:
    await ws_manager.connect(org_id=org_id, websocket=websocket)
    try:
        while True:
            message = await websocket.receive_text()
            if message.strip().lower() == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        await ws_manager.disconnect(org_id=org_id, websocket=websocket)
    except Exception:
        await ws_manager.disconnect(org_id=org_id, websocket=websocket)
        raise
