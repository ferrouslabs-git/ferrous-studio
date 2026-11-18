"""CloudOps actions API (INT-REQ-14, phase 3): start and stop services, and tune auto-wake for non-production ones.

Studio itself has NO permission to change a service. Every change goes through the ``cloudops-control``
function, which only this app's task role may invoke.

Production services may be started and stopped (decision of 2026-11-18), except the service this app runs as
(``own_service()``): stopping it would switch this panel off. That one is refused in layers, so a bug in one cannot
do it:

  1. this module refuses it before calling anything, and writes the refusal to the audit log
  2. the control function refuses it again (PROTECTED_SERVICES)
  3. AWS denies it regardless of what either of them does (an explicit IAM deny on that service)

Auto-wake and keep-awake stay non-production only, refused here and in the control function.

Every attempt, including refusals and failures, is written to ``cloudops_actions`` with who, what, which service
and the state before and after. Platform administrators only; on only where ``CLOUDOPS_ENABLED`` is.
"""
import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.api.route_helpers import ensure_platform_admin
from app.auth.database import get_db
from app.auth.models.user import User
from app.auth.security import get_current_user
from app.config import get_settings

from .cloudops import _aws_error
from .cloudops_resources import own_service
from .models import CloudopsAction

router = APIRouter()

SERVICE_RE = re.compile(r"^[A-Za-z0-9_-]{1,255}$")
OWN_SERVICE_MESSAGE = "This service runs Studio itself, so it cannot be changed from here. Use the AWS console."
AUTOWAKE_PRODUCTION_MESSAGE = "Auto-wake is for non-production services only. Start or stop production by hand."
SLEEP_ACTIONS = ("set_autowake", "set_keep_awake")


class AutoWakeBody(BaseModel):
    enabled: bool
    idle_minutes: int | None = Field(default=None, ge=5, le=1440)


class KeepAwakeBody(BaseModel):
    until: datetime | None = None


class ActionResult(BaseModel):
    ok: bool
    action: str
    service: str
    changed: bool
    before: dict[str, Any]
    after: dict[str, Any]


class ActionRead(BaseModel):
    id: str
    created_at: datetime
    user_email: str
    action: str
    service: str
    params: dict[str, Any]
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    status: str
    message: str | None = None


def _invoke_control(payload: dict[str, Any]) -> dict[str, Any]:
    """The only AWS write in this app: ask the control function to act. Runs in a worker thread."""
    import boto3

    client = boto3.client("lambda", region_name=os.getenv("AWS_REGION", "eu-west-1"))
    out = client.invoke(FunctionName=os.getenv("CLOUDOPS_CONTROL_FUNCTION", "cloudops-control"),
                        InvocationType="RequestResponse", Payload=json.dumps(payload).encode())
    if out.get("FunctionError"):
        raise RuntimeError("the control function crashed")
    return json.loads(out["Payload"].read())


async def _record(db: AsyncSession, user: User, action: str, service: str, params: dict[str, Any],
                  outcome: str, message: str | None = None, before: dict | None = None, after: dict | None = None) -> None:
    db.add(CloudopsAction(user_id=user.id, user_email=user.email, action=action, service=service[:255], params=params,
                          before=before, after=after, status=outcome, message=(message or None) and message[:500]))
    await db.commit()


async def _act(db: AsyncSession, user: User, action: str, service: str, params: dict[str, Any]) -> ActionResult:
    if not get_settings().cloudops_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CloudOps is not enabled in this environment")
    if not SERVICE_RE.match(service) or service == own_service():
        await _record(db, user, action, service, params, "refused", OWN_SERVICE_MESSAGE)
        raise HTTPException(status.HTTP_403_FORBIDDEN, OWN_SERVICE_MESSAGE)
    if action in SLEEP_ACTIONS and "-prod" in service:
        await _record(db, user, action, service, params, "refused", AUTOWAKE_PRODUCTION_MESSAGE)
        raise HTTPException(status.HTTP_403_FORBIDDEN, AUTOWAKE_PRODUCTION_MESSAGE)

    payload = {"action": action, "service": service, **params, "requested_by": user.email}
    try:
        out = await asyncio.to_thread(_invoke_control, payload)
    except Exception as exc:
        await _record(db, user, action, service, params, "error", f"{type(exc).__name__}")
        raise _aws_error(exc, "the action", "permission to invoke the CloudOps control function") from exc

    if not out.get("ok"):
        refused = bool(out.get("refused"))
        message = str(out.get("error") or "The action failed.")
        await _record(db, user, action, service, params, "refused" if refused else "error", message)
        raise HTTPException(status.HTTP_409_CONFLICT if refused else status.HTTP_502_BAD_GATEWAY, message)

    await _record(db, user, action, service, params, "ok", None, out.get("before"), out.get("after"))
    return ActionResult(ok=True, action=action, service=service, changed=bool(out.get("changed")),
                        before=out.get("before") or {}, after=out.get("after") or {})


@router.post("/admin/cloudops/resources/{service}/start", response_model=ActionResult)
async def start_service(service: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> ActionResult:
    await ensure_platform_admin(current_user, "start a service", db)
    return await _act(db, current_user, "start", service, {})


@router.post("/admin/cloudops/resources/{service}/stop", response_model=ActionResult)
async def stop_service(service: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> ActionResult:
    await ensure_platform_admin(current_user, "stop a service", db)
    return await _act(db, current_user, "stop", service, {})


@router.patch("/admin/cloudops/resources/{service}/autowake", response_model=ActionResult)
async def set_autowake(service: str, body: AutoWakeBody, current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> ActionResult:
    await ensure_platform_admin(current_user, "change auto-wake", db)
    return await _act(db, current_user, "set_autowake", service, {"enabled": body.enabled, "idle_minutes": body.idle_minutes})


@router.patch("/admin/cloudops/resources/{service}/keep-awake", response_model=ActionResult)
async def set_keep_awake(service: str, body: KeepAwakeBody, current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)) -> ActionResult:
    await ensure_platform_admin(current_user, "change keep-awake", db)
    return await _act(db, current_user, "set_keep_awake", service, {"until": body.until.isoformat() if body.until else None})


@router.get("/admin/cloudops/actions", response_model=list[ActionRead])
async def list_actions(limit: int = Query(50, ge=1, le=200), current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> list[ActionRead]:
    await ensure_platform_admin(current_user, "view the CloudOps audit log", db, permission="accounts:read")
    rows = (await db.execute(select(CloudopsAction).order_by(CloudopsAction.created_at.desc()).limit(limit))).scalars().all()
    return [ActionRead(id=str(r.id), created_at=r.created_at, user_email=r.user_email, action=r.action, service=r.service,
                       params=r.params or {}, before=r.before, after=r.after, status=r.status, message=r.message) for r in rows]
