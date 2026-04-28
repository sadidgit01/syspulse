from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_session
from app.schemas.auth import UserIdentity
from app.schemas.push import PushSubscriptionRequest, PushSubscriptionResponse
from app.services.push_service import push_service

router = APIRouter(prefix="/push")


@router.post("/subscribe", response_model=PushSubscriptionResponse, status_code=status.HTTP_201_CREATED)
async def subscribe_push(
    payload: PushSubscriptionRequest,
    user: UserIdentity = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PushSubscriptionResponse:
    await push_service.subscribe(
        session=session,
        org_id=user.org_id,
        user_id=user.user_id,
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
    )
    return PushSubscriptionResponse(status="ok")
