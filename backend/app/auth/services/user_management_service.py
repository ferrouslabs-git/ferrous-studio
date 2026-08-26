"""
Service logic for tenant user-management APIs.
"""
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models.membership import Membership
from ..models.user import User


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
    if status_filter:
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

    if not actor_is_platform_admin:
        actor_effective = actor_role or ""

        # Only owners (or platform admins, handled above) can assign owner roles.
        if new_role in {"owner", "account_owner"}:
            if actor_effective not in ("owner", "account_owner"):
                raise ValueError("Only account owners can assign the owner role")

        if actor_effective in ("admin", "account_admin"):
            if current_role in ("owner", "account_owner"):
                raise ValueError("Admins cannot modify owner roles")
            if new_role in {"admin", "account_admin"}:
                raise ValueError("Admins can only assign member or viewer roles")

    # Prevent removing the last owner / account_owner.
    if current_role in ("owner", "account_owner") and new_role not in ("owner", "account_owner"):
        count_result = await db.execute(
            select(func.count()).select_from(Membership).where(
                Membership.scope_type == "account",
                Membership.scope_id == tenant_id,
                Membership.status == "active",
                Membership.role_name.in_(["account_owner", "owner"]),
            )
        )
        owner_count = count_result.scalar()
        if owner_count <= 1:
            raise ValueError("Cannot remove last owner")

    membership.role_name = new_role
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

    # Prevent removing the last owner / account_owner.
    if current_role in ("owner", "account_owner"):
        count_result = await db.execute(
            select(func.count()).select_from(Membership).where(
                Membership.scope_type == "account",
                Membership.scope_id == tenant_id,
                Membership.status == "active",
                Membership.role_name.in_(["account_owner", "owner"]),
            )
        )
        owner_count = count_result.scalar()
        if owner_count <= 1:
            raise ValueError("Cannot remove last owner")

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
