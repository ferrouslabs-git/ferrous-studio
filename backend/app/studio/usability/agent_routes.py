"""What an agent may do to a usability study.

These are the only usability routes a board token reaches (the MCP server's
study tools call them). They are deliberately not the editor's routes:

* **Nothing about a participant is returned or changed.** The editor's study
  read carries every participant with their link and test account password;
  these return the study's details, research questions, tasks and file names
  and nothing else.
* **An agent adds and corrects; it does not remove or replace.** Tasks are
  appended, or one is edited by id. There is no delete and no "replace all",
  so a mistaken run cannot wipe what a person wrote, and results captured
  against a task stay attached to it.
* **The protocol, consent form and script stay with a person.** A participant
  agrees to that wording.

A person signed in as an organisation admin reaches them too (``data:write``),
which is what a board token also carries -- only an admin can mint one.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security.scope_context import ScopeContext

from ..common import get_project, require_studio_permission
from . import content as rules
from .models import Study
from .routes import BASE, _file_out, _files, _organisation_name, _save_file, _study
from .schemas import AgentStudyCreate, AgentTaskPatch, AgentTasksIn, StudyContent, StudyFileIn

router = APIRouter()

AGENT = f"{BASE}/agent"


def _summary(study: Study) -> dict[str, Any]:
    return {
        "id": study.id,
        "name": study.name,
        "status": study.status,
        "persona": study.persona or "",
        "duration": study.duration or "",
        "app_url": study.app_url or "",
        "task_count": len(study.content.get("tasks", [])),
    }


async def _out(db: AsyncSession, study: Study) -> dict[str, Any]:
    """The study as an agent sees it: what is tested, and nothing of who."""
    return {
        **_summary(study),
        "research_questions": study.content.get("research_questions", []),
        "tasks": study.content.get("tasks", []),
        "files": [_file_out(f) for f in await _files(db, study)],
    }


def _open(study: Study) -> Study:
    if study.status != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This study is closed. A person reopens it in Studio."
        )
    return study


async def _check_files(db: AsyncSession, study: Study, tasks: list[dict[str, Any]]) -> None:
    """A task may only hand out a file the study holds: a name that matches
    nothing would show the participant a download that is not there."""
    held = {f.name for f in await _files(db, study)}
    errors = [
        f'task "{task["title"]}": no file called "{name}" on this study -- upload it first'
        for task in tasks
        for name in task.get("files", [])
        if name not in held
    ]
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)


@router.get(f"{AGENT}/task-guide")
async def usability_task_guide(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """How to write a study's tasks. Not project-specific; served per project
    so the MCP server reaches it the way it reaches everything else."""
    await get_project(db, project_id, ctx)
    return {"guide": rules.TASK_GUIDE}


@router.get(f"{AGENT}/studies")
async def list_usability_studies_for_agent(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    project = await get_project(db, project_id, ctx)
    studies = (
        await db.execute(
            select(Study)
            .where(Study.account_id == project.account_id, Study.lineage_id == project.lineage_id)
            .order_by(Study.created_at.desc())
        )
    ).scalars().all()
    return [_summary(s) for s in studies]


@router.get(f"{AGENT}/studies/{{study_id}}")
async def get_usability_study_for_agent(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    return await _out(db, await _study(db, project, study_id))


@router.post(f"{AGENT}/studies", status_code=status.HTTP_201_CREATED)
async def create_usability_study_for_agent(
    project_id: UUID,
    payload: AgentStudyCreate,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A new study with the default protocol, consent form and script, and no
    tasks yet."""
    project = await get_project(db, project_id, ctx)
    content = rules.default_content(await _organisation_name(db, project.account_id))
    content["research_questions"] = payload.research_questions
    study = Study(
        account_id=project.account_id,
        lineage_id=project.lineage_id,
        name=payload.name,
        persona=payload.persona or None,
        duration=payload.duration or None,
        app_url=payload.app_url or None,
        content=StudyContent.model_validate(content).model_dump(),
        created_by=ctx.user_id,
    )
    db.add(study)
    await db.flush()
    out = await _out(db, study)
    await db.commit()
    return out


@router.post(f"{AGENT}/studies/{{study_id}}/tasks", status_code=status.HTTP_201_CREATED)
async def add_usability_tasks(
    project_id: UUID,
    study_id: UUID,
    payload: AgentTasksIn,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Append tasks, in the order given, after the ones already there. All or
    nothing."""
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    new_tasks = [task.model_dump() for task in payload.tasks]
    await _check_files(db, study, new_tasks)
    content = dict(study.content or {})
    existing = list(content.get("tasks", []))
    if len(existing) + len(new_tasks) > 60:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A study holds at most 60 tasks")
    content["tasks"] = existing + new_tasks          # StudyContent gives each new one an id
    if payload.research_questions is not None:
        content["research_questions"] = payload.research_questions
    study.content = StudyContent.model_validate(content).model_dump()
    await db.flush()
    out = await _out(db, study)
    await db.commit()
    return out


@router.patch(f"{AGENT}/studies/{{study_id}}/tasks/{{task_id}}")
async def update_usability_task(
    project_id: UUID,
    study_id: UUID,
    task_id: str,
    payload: AgentTaskPatch,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Change the fields sent on one task. Its id, its place in the order and
    anything captured against it stay as they are."""
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    content = dict(study.content or {})
    tasks = [dict(task) for task in content.get("tasks", [])]
    task = next((t for t in tasks if t.get("id") == task_id), None)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    sent = payload.model_fields_set
    for name in ("title", "scenario", "notes", "files", "success", "path", "watch", "probes"):
        if name in sent and getattr(payload, name) is not None:
            task[name] = getattr(payload, name)
    if "answer_prompt" in sent:
        task["answer_prompt"] = payload.answer_prompt or None    # "" or null takes the question away
    if "files" in sent:
        await _check_files(db, study, [task])
    content["tasks"] = tasks
    study.content = StudyContent.model_validate(content).model_dump()
    await db.flush()
    out = await _out(db, study)
    await db.commit()
    return out


@router.post(f"{AGENT}/studies/{{study_id}}/files", status_code=status.HTTP_201_CREATED)
async def upload_usability_file_for_agent(
    project_id: UUID,
    study_id: UUID,
    payload: StudyFileIn,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add a file a task can hand out, or replace the one of the same name."""
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    out = _file_out(await _save_file(db, study, payload))
    await db.commit()
    return out
