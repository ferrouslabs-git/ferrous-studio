from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health_check() -> dict[str, str]:
    """GET /api/health — the shared ALB's target group health check path
    (see infra/ecs/taskdef.template.json / infra/docs/onboarding-runbook.md)."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "env": settings.app_env,
    }
