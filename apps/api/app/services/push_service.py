from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import PushSubscription

logger = logging.getLogger(__name__)
settings = get_settings()


class PushService:
    @staticmethod
    async def subscribe(
        session: AsyncSession,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        endpoint: str,
        p256dh: str,
        auth: str,
    ) -> None:
        statement = (
            pg_insert(PushSubscription)
            .values(
                org_id=org_id,
                user_id=user_id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
            )
            .on_conflict_do_update(
                constraint="uq_push_subscriptions_endpoint",
                set_={
                    "org_id": org_id,
                    "user_id": user_id,
                    "p256dh": p256dh,
                    "auth": auth,
                },
            )
        )
        await session.execute(statement)
        await session.commit()

    @staticmethod
    async def send_alert(
        session: AsyncSession,
        *,
        org_id: uuid.UUID,
        title: str,
        body: str,
        url: str = "/dashboard/incidents",
    ) -> None:
        if not settings.vapid_public_key or not settings.vapid_private_key:
            logger.info("Skipping push notification because VAPID keys are not configured.")
            return

        subscriptions = (
            await session.scalars(
                select(PushSubscription).where(PushSubscription.org_id == org_id)
            )
        ).all()
        if not subscriptions:
            return

        payload = json.dumps(
            {
                "title": title,
                "body": body,
                "url": url,
            }
        )
        for subscription in subscriptions:
            await _send_subscription(subscription, payload)


async def _send_subscription(subscription: PushSubscription, payload: str) -> None:
    try:
        from pywebpush import WebPushException, webpush

        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {
                    "p256dh": subscription.p256dh,
                    "auth": subscription.auth,
                },
            },
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": "mailto:ops@syspulse.local"},
        )
    except Exception as exc:
        if exc.__class__.__name__ == "WebPushException":
            logger.warning("Push notification delivery failed: %s", exc)
            return
        logger.exception("Unexpected push notification failure.")


push_service = PushService()
