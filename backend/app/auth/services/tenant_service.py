"""
Tenant service - handles tenant creation and management
"""
from sqlalchemy import select, delete as sa_delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional
from uuid import UUID

from ..models.tenant import Tenant
from ..models.membership import Membership
from ..models.user import User

from .space_service import create_space

DEFAULT_SPACE_NAME = "General"


async def create_tenant(
    name: str,
    user: User,
    db: AsyncSession,
    plan: str = "free"
) -> Tenant:
    """Create a new tenant and assign creator as owner."""
    tenant = Tenant(
        name=name,
        plan=plan,
        status="active"
    )
    db.add(tenant)
    await db.flush()
    
    membership = Membership(
        user_id=user.id,
        scope_type="account",
        scope_id=tenant.id,
        role_name="account_owner",
        status="active"
    )
    db.add(membership)
    await db.flush()

    # Every organisation starts with one workspace so it is usable straight
    # away; the workspace switcher only appears once there is more than one.
    # create_space commits, which also persists the tenant and membership.
    await create_space(db, DEFAULT_SPACE_NAME, tenant.id, user.id)
    await db.refresh(tenant)

    return tenant


async def get_tenant_by_id(tenant_id: UUID, db: AsyncSession) -> Optional[Tenant]:
    """Get tenant by ID."""
    result = await db.execute(
        select(Tenant)
        .options(selectinload(Tenant.memberships))
        .where(Tenant.id == tenant_id)
    )
    return result.scalar_one_or_none()


async def get_user_tenants(user_id: UUID, db: AsyncSession) -> List[dict]:
    """Get all tenants that a user belongs to with their role."""
    result = await db.execute(
        select(Membership)
        .options(selectinload(Membership.tenant))
        .where(
            Membership.user_id == user_id,
            Membership.scope_type == "account",
            Membership.status == "active",
        )
    )
    memberships = result.scalars().all()
    
    results = []
    for membership in memberships:
        tenant_data = {
            "id": membership.tenant.id if membership.tenant else membership.scope_id,
            "name": membership.tenant.name if membership.tenant else None,
            "plan": membership.tenant.plan if membership.tenant else None,
            "status": membership.tenant.status if membership.tenant else None,
            "role": membership.role_name,
            "created_at": membership.tenant.created_at if membership.tenant else None
        }
        results.append(tenant_data)
    
    return results


async def get_user_tenant_role(
    user_id: UUID,
    tenant_id: UUID,
    db: AsyncSession
) -> Optional[str]:
    """Get user's role in a specific tenant."""
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
            Membership.status == "active",
        )
    )
    membership = result.scalar_one_or_none()
    return membership.role_name if membership else None


async def list_platform_tenants(db: AsyncSession) -> List[dict]:
    result = await db.execute(
        select(Tenant)
        .options(selectinload(Tenant.memberships))
        .order_by(Tenant.name.asc())
    )
    tenants = result.scalars().all()

    return [
        {
            "tenant_id": tenant.id,
            "name": tenant.name,
            "plan": tenant.plan,
            "status": tenant.status,
            "created_at": tenant.created_at,
            "member_count": sum(1 for membership in tenant.memberships if membership.status == "active"),
            "owner_count": sum(
                1
                for membership in tenant.memberships
                if membership.status == "active" and membership.role_name in ("account_owner", "owner")
            ),
        }
        for tenant in tenants
    ]


async def verify_user_tenant_access(
    user_id: UUID,
    tenant_id: UUID,
    db: AsyncSession
) -> bool:
    """Verify if user has access to a tenant."""
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
            Membership.status == "active",
        )
    )
    membership = result.scalar_one_or_none()
    return membership is not None


async def suspend_tenant(tenant_id: UUID, db: AsyncSession) -> Tenant:
    """Suspend a tenant to block organization-level operations."""
    tenant = await get_tenant_by_id(tenant_id, db)
    if not tenant:
        raise ValueError(f"Tenant not found: {tenant_id}")

    tenant.status = "suspended"
    await db.commit()
    await db.refresh(tenant)
    return tenant


async def unsuspend_tenant(tenant_id: UUID, db: AsyncSession) -> Tenant:
    """Restore a suspended tenant back to active status."""
    tenant = await get_tenant_by_id(tenant_id, db)
    if not tenant:
        raise ValueError(f"Tenant not found: {tenant_id}")

    tenant.status = "active"
    await db.commit()
    await db.refresh(tenant)
    return tenant


async def update_tenant(tenant_id: UUID, db: AsyncSession, *, name: str | None = None, plan: str | None = None) -> Tenant:
    """Update mutable tenant fields (name, plan)."""
    tenant = await get_tenant_by_id(tenant_id, db)
    if not tenant:
        raise ValueError(f"Tenant not found: {tenant_id}")

    if name is not None:
        tenant.name = name
    if plan is not None:
        tenant.plan = plan

    await db.commit()
    await db.refresh(tenant, attribute_names=["memberships"])
    return tenant


async def delete_tenant(tenant_id: UUID, db: AsyncSession) -> dict:
    """Permanently delete a tenant and all associated data."""
    from ..models.invitation import Invitation
    from ..models.space import Space

    tenant = await get_tenant_by_id(tenant_id, db)
    if not tenant:
        raise ValueError(f"Tenant not found: {tenant_id}")

    name = tenant.name

    # Delete account-scoped memberships
    await db.execute(
        sa_delete(Membership).where(
            Membership.scope_type == "account",
            Membership.scope_id == tenant_id,
        )
    )

    # Delete spaces belonging to this tenant and their space-scoped memberships
    space_result = await db.execute(select(Space).where(Space.account_id == tenant_id))
    space_ids = [s.id for s in space_result.scalars().all()]
    if space_ids:
        await db.execute(
            sa_delete(Membership).where(
                Membership.scope_type == "space",
                Membership.scope_id.in_(space_ids),
            )
        )
        await db.execute(sa_delete(Space).where(Space.account_id == tenant_id))

    # Invitations cascade via FK, but be explicit
    await db.execute(sa_delete(Invitation).where(Invitation.tenant_id == tenant_id))

    await db.delete(tenant)
    await db.commit()

    return {"tenant_id": str(tenant_id), "name": name}
