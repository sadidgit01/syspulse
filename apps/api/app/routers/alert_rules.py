from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_role
from app.database import get_session
from app.models import AlertRule, UserRole
from app.schemas.alert_rule import AlertRuleCreate, AlertRuleRead, AlertRuleTestResponse, AlertRuleUpdate
from app.schemas.auth import UserIdentity
from app.services.alert_evaluator import alert_evaluator

router = APIRouter()


@router.get("/alert-rules", response_model=list[AlertRuleRead])
async def list_alert_rules(
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> list[AlertRuleRead]:
    rows = (
        await session.scalars(
            select(AlertRule)
            .where(AlertRule.org_id == user.org_id)
            .order_by(AlertRule.created_at.desc())
        )
    ).all()
    return [_serialize_alert_rule(row) for row in rows]


@router.post("/alert-rules", response_model=AlertRuleRead, status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    payload: AlertRuleCreate,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> AlertRuleRead:
    rule = AlertRule(
        org_id=user.org_id,
        name=payload.name,
        description=payload.description,
        is_enabled=payload.is_enabled,
        condition_type=payload.condition_type,
        condition_json=payload.condition_json,
        severity=payload.severity,
        channels_json=payload.channels_json,
        cooldown_minutes=payload.cooldown_minutes,
        created_by=user.user_id,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return _serialize_alert_rule(rule)


@router.get("/alert-rules/{rule_id}", response_model=AlertRuleRead)
async def get_alert_rule(
    rule_id: UUID,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.VIEWER, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> AlertRuleRead:
    return _serialize_alert_rule(await _get_alert_rule(session, user.org_id, rule_id))


@router.put("/alert-rules/{rule_id}", response_model=AlertRuleRead)
async def update_alert_rule(
    rule_id: UUID,
    payload: AlertRuleUpdate,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> AlertRuleRead:
    rule = await _get_alert_rule(session, user.org_id, rule_id)
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(rule, key, value)
    await session.commit()
    await session.refresh(rule)
    return _serialize_alert_rule(rule)


@router.delete("/alert-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_rule(
    rule_id: UUID,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rule = await _get_alert_rule(session, user.org_id, rule_id)
    await session.delete(rule)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/alert-rules/{rule_id}/test", response_model=AlertRuleTestResponse)
async def test_alert_rule(
    rule_id: UUID,
    user: UserIdentity = Depends(
        require_role([UserRole.ADMIN, UserRole.ALERT_MANAGER])
    ),
    session: AsyncSession = Depends(get_session),
) -> AlertRuleTestResponse:
    rule = await _get_alert_rule(session, user.org_id, rule_id)
    return await alert_evaluator.preview_rule(session, rule, user.org_id)


async def _get_alert_rule(session: AsyncSession, org_id, rule_id: UUID) -> AlertRule:
    rule = await session.scalar(
        select(AlertRule).where(AlertRule.id == rule_id, AlertRule.org_id == org_id)
    )
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found.",
        )
    return rule


def _serialize_alert_rule(rule: AlertRule) -> AlertRuleRead:
    return AlertRuleRead(
        id=rule.id,
        org_id=rule.org_id,
        name=rule.name,
        description=rule.description,
        is_enabled=bool(rule.is_enabled),
        condition_type=rule.condition_type,
        condition_json=rule.condition_json or {},
        severity=rule.severity,
        channels_json=rule.channels_json or [],
        cooldown_minutes=int(rule.cooldown_minutes),
        last_fired_at=rule.last_fired_at,
        created_by=rule.created_by,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )
