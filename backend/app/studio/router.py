"""Studio API aggregator. Every resource lives in its own module; this file
only mounts them under ``/studio`` so ``app/main.py`` keeps one import.

Every route is scoped to an *organisation* via X-Scope-Type/X-Scope-ID and
guarded by ``data:read`` / ``data:write``. Every query filters by
``ctx.scope_id`` explicitly, and the tables also carry row-level-security
policies keyed on the same value -- two layers, always. See ``common.py``.
"""
from fastapi import APIRouter

from .annotations import router as annotations_router
from .audit import router as audit_router
from .board.agent_routes import router as board_agent_router
from .board.routes import router as board_router
from .datasets import router as datasets_router
from .diagrams import router as diagrams_router
from .documents import router as documents_router
from .github import project_router as github_project_router
from .github import router as github_router
from .importing import router as importing_router
from .personas import router as personas_router
from .projects import router as projects_router
from .use_cases import router as use_cases_router
from .wireframes import router as wireframes_router

router = APIRouter(prefix="/studio", tags=["studio"])
router.include_router(projects_router)
router.include_router(wireframes_router)
router.include_router(annotations_router)
router.include_router(audit_router)
router.include_router(personas_router)
router.include_router(diagrams_router)
router.include_router(documents_router)
router.include_router(use_cases_router)
router.include_router(datasets_router)
router.include_router(importing_router)
router.include_router(github_router)
# Repository links hang off a project, so they carry no /github prefix.
router.include_router(github_project_router)
router.include_router(board_router)
router.include_router(board_agent_router)
