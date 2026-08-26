from fastapi import APIRouter, Depends

from ..security import (
    ScopeContext,
    get_scope_context,
    require_permission,
)

router = APIRouter()


@router.get("/admin/settings")
async def get_admin_settings(ctx: ScopeContext = Depends(require_permission("members:manage"))):
    """Admin-only endpoint - requires members:manage permission."""
    return {
        "scope_id": str(ctx.scope_id),
        "accessed_by": str(ctx.user_id),
        "active_roles": ctx.active_roles,
        "message": "Admin settings accessed successfully",
        "settings": {
            "max_users": 50,
            "api_enabled": True,
            "webhooks_configured": False,
        },
    }


@router.get("/owner/danger-zone")
async def get_owner_settings(ctx: ScopeContext = Depends(require_permission("account:delete"))):
    """Owner-only endpoint - requires account:delete permission."""
    return {
        "scope_id": str(ctx.scope_id),
        "accessed_by": str(ctx.user_id),
        "active_roles": ctx.active_roles,
        "message": "Owner-only danger zone accessed",
        "available_actions": [
            "delete_tenant",
            "transfer_ownership",
            "view_billing",
            "cancel_subscription",
        ],
    }


@router.get("/member/dashboard")
async def get_member_dashboard(ctx: ScopeContext = Depends(require_permission("data:write"))):
    """Member-level endpoint - requires data:write permission."""
    return {
        "scope_id": str(ctx.scope_id),
        "accessed_by": str(ctx.user_id),
        "active_roles": ctx.active_roles,
        "message": "Member dashboard accessed",
        "can_create": True,
        "can_edit": True,
        "can_delete": ctx.has_permission("members:manage"),
        "recent_activity": [],
    }


@router.get("/viewer/reports")
async def get_viewer_reports(ctx: ScopeContext = Depends(require_permission("data:read"))):
    """Viewer-level endpoint - any member with data:read can access."""
    return {
        "scope_id": str(ctx.scope_id),
        "accessed_by": str(ctx.user_id),
        "active_roles": ctx.active_roles,
        "message": "Reports accessed (read-only)",
        "reports": [
            {"id": 1, "name": "Monthly Summary", "type": "summary"},
            {"id": 2, "name": "User Activity", "type": "analytics"},
        ],
    }


@router.get("/permissions/check")
async def check_user_permissions(ctx: ScopeContext = Depends(get_scope_context)):
    """Check what permissions the current user has in this scope."""
    permissions_to_check = [
        "account:delete",
        "account:read",
        "spaces:create",
        "members:manage",
        "members:invite",
        "data:read",
        "data:write",
        "space:delete",
        "space:configure",
        "space:read",
    ]

    user_permissions = {
        permission: ctx.has_permission(permission)
        for permission in permissions_to_check
    }

    return {
        "scope_type": ctx.scope_type,
        "scope_id": str(ctx.scope_id),
        "user_id": str(ctx.user_id),
        "active_roles": ctx.active_roles,
        "is_super_admin": ctx.is_super_admin,
        "permissions": user_permissions,
        "message": "Permission check complete",
    }