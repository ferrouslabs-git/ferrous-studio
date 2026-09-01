"""
Service logic for tenant user-management APIs.
"""
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models.membership import Membership
from ..models.user import User


async def _active_admin_count(db: AsyncSession, tenant_id: UUID) -> int:
    """Active organisation admins, counting the legacy role name too."""
    result = await db.execute(
        select(func.count()).select_from(Membership).where(
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
            Membership.status == "active",
            Membership.role_name.in_(["account_admin", "admin"]),
        )
    )
    return result.scalar() or 0


async def list_tenant_users(
    db: AsyncSession,
    tenant_id: UUID,
    *,
    role: str | None = None,
    status_filter: str | None = None,
) -> list[dict]:
    stmt = (
        select(Membership)
        .options(selectinload(Membership.user))
        .where(
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
        )
    )
    # "all" returns every membership regardless of status (the Users page
    # shows archived members alongside active ones).
    if status_filter and status_filter != "all":
        stmt = stmt.where(Membership.status == status_filter)
    else:
        stmt = stmt.where(Membership.status == "active")
    if role:
        stmt = stmt.where(Membership.role_name == role)
    result = await db.execute(stmt)
    memberships = result.scalars().all()

    return [
        {
            "user_id": m.user.id,
            "email": m.user.email,
            "name": m.user.name,
            "role": m.role_name,
            "status": m.status,
            "is_active": m.user.is_active,
            "joined_at": m.created_at,
        }
        for m in memberships
    ]


async def list_platform_users(db: AsyncSession, *, role: str | None = None) -> list[dict]:
    stmt = (
        select(User)
        .options(selectinload(User.memberships).selectinload(Membership.tenant))
        .order_by(User.email.asc())
    )
    if role:
        subq = select(Membership.user_id).where(
            Membership.role_name == role,
            Membership.status == "active",
        ).scalar_subquery()
        stmt = stmt.where(User.id.in_(subq))
    result = await db.execute(stmt)
    users = result.scalars().all()

    return [
        {
            "user_id": user.id,
            "email": user.email,
            "name": user.name,
            "is_platform_admin": user.is_platform_admin,
            "is_active": user.is_active,
            "suspended_at": user.suspended_at,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "memberships": [
                {
                    "tenant_id": membership.scope_id if membership.scope_type == "account" else None,
                    "tenant_name": membership.tenant.name if membership.tenant else None,
                    "role": membership.role_name,
                    "scope_type": membership.scope_type,
                    "scope_id": membership.scope_id,
                    "status": membership.status,
                    "joined_at": membership.created_at,
                }
                for membership in sorted(
                    user.memberships,
                    key=lambda m: m.created_at,
                )
            ],
        }
        for user in users
    ]


async def update_user_role(
    db: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    new_role: str,
    actor_role: str | None,
    actor_is_platform_admin: bool = False,
) -> Membership | None:
    result = await db.execute(
        select(Membership).where(
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
            Membership.user_id == user_id,
            Membership.status == "active",
        )
    )
    membership = result.scalar_one_or_none()

    if not membership:
        return None

    current_role = membership.role_name

    # Admin is the top organisation role, so an admin may assign any of the
    # three (including admin); anyone below cannot change roles at all.
    if not actor_is_platform_admin and (actor_role or "") not in ("admin", "account_admin"):
        raise ValueError("Only organisation admins can change member roles")

    # Prevent removing the last admin -- an organisation with none is
    # unmanageable by anyone short of a platform admin.
    if current_role in ("admin", "account_admin") and new_role not in ("admin", "account_admin"):
        if await _active_admin_count(db, tenant_id) <= 1:
            raise ValueError("Cannot remove the last organisation admin")

    membership.role_name = new_role
    await db.commit()
    await db.refresh(membership)
    return membership


async def update_tenant_user_name(
    db: AsyncSession, tenant_id: UUID, user_id: UUID, name: str | None
) -> Membership | None:
    """Set a member's display name. The name lives on the user, not the
    membership, so it shows in every organisation they belong to -- an admin
    here may only edit it for someone who is an active member here."""
    result = await db.execute(
        select(Membership)
        .options(selectinload(Membership.user))
        .where(
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
            Membership.user_id == user_id,
            Membership.status == "active",
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        return None

    membership.user.name = (name or "").strip() or None
    await db.commit()
    await db.refresh(membership)
    return membership


async def remove_user_from_tenant(db: AsyncSession, tenant_id: UUID, user_id: UUID) -> Membership | None:
    result = await db.execute(
        select(Membership).where(
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
            Membership.user_id == user_id,
            Membership.status == "active",
        )
    )
    membership = result.scalar_one_or_none()

    if not membership:
        return None

    current_role = membership.role_name

    # Prevent removing the last admin.
    if current_role in ("admin", "account_admin"):
        if await _active_admin_count(db, tenant_id) <= 1:
            raise ValueError("Cannot remove the last organisation admin")

    membership.status = "removed"
    await db.commit()
    await db.refresh(membership)
    return membership


async def reactivate_user_in_tenant(db: AsyncSession, tenant_id: UUID, user_id: UUID) -> Membership | None:
    """Reactivate a previously removed membership (status 'removed' → 'active')."""
    result = await db.execute(
        select(Membership).where(
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
            Membership.user_id == user_id,
            Membership.status == "removed",
        )
    )
    membership = result.scalar_one_or_none()

    if not membership:
        return None

    membership.status = "active"
    await db.commit()
    await db.refresh(membership)
    return membership
