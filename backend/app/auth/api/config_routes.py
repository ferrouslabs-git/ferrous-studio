"""Configuration routes — expose role/permission definitions (v3.0)."""
from fastapi import APIRouter, Depends

from ..models.user import User
from ..security import ScopeContext, get_current_user, require_super_admin
from ..services.auth_config_loader import get_auth_config

router = APIRouter()


@router.get("/config/roles")
async def get_role_definitions(current_user: User = Depends(get_current_user)):
    """Return role definitions and display names for current deployment."""
    config = get_auth_config()
    roles: dict[str, list[dict]] = {}
    for layer, layer_roles in config.roles_by_layer.items():
        roles[layer] = [
            {"name": r["name"], "display_name": r["display_name"], "layer": r["layer"]}
            for r in layer_roles
        ]
    return {
        "version": config.version,
        "roles": roles,
    }


@router.get("/config/permissions")
async def get_permission_map(ctx: ScopeContext = Depends(require_super_admin)):
    """Return full permission map for current deployment (super admin only)."""
    config = get_auth_config()
    permission_map = {
        role: sorted(perms)
        for role, perms in config.permission_map.items()
    }
    return {
        "version": config.version,
        "permission_map": permission_map,
        "inheritance": config.inheritance_config,
    }
