"""Authentication API router composition layer."""

from fastapi import APIRouter

from ..config import get_settings
from ..services.cookie_token_service import (
	call_cognito_refresh_async,
	clear_csrf_cookie,
	clear_refresh_cookie,
	generate_csrf_token,
	get_refresh_token,
	revoke_refresh_token,
	rotate_refresh_token,
	set_csrf_cookie,
	set_refresh_cookie,
	store_refresh_token,
)
from .auth_routes import router as auth_router
from .config_routes import router as config_router
from .custom_ui_routes import router as custom_ui_router
from .invitation_routes import router as invitation_router
from .permission_demo_routes import router as permission_demo_router
from .platform_user_routes import router as platform_user_router
from .platform_tenant_routes import router as platform_tenant_router
from .refresh_token_routes import router as refresh_token_router
from .session_routes import router as session_router
from .space_routes import router as space_router
from .tenant_routes import router as tenant_router
from .tenant_user_routes import router as tenant_user_router

router = APIRouter()

router.include_router(auth_router)
router.include_router(config_router)
router.include_router(custom_ui_router)
router.include_router(tenant_router)
router.include_router(permission_demo_router)
router.include_router(invitation_router)
router.include_router(tenant_user_router)
router.include_router(session_router)
router.include_router(platform_user_router)
router.include_router(platform_tenant_router)
router.include_router(refresh_token_router)
router.include_router(space_router)
