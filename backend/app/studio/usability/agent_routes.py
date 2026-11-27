"""What an agent may do to a usability study.

These are the only usability routes a board token reaches (the MCP server's
study tools call them). They cover what the editor does, with three
differences that are the point of keeping them separate from the editor's
routes:

* **No secrets come back.** A participant is returned without their link
  token, and their test account password is write-only: an agent can set it,
  and sees only whether one is set (``account_password_set``). Both would
  otherwise sit in the agent's transcript. A person copies the link and reads
  the password in Studio.
* **Nothing is deleted.** No study, task, participant, observation or file is
  removed here, and tasks are never replaced wholesale: they are appended,
  corrected by id, or reordered with every id accounted for. So a mistaken
  run cannot wipe what a person wrote, and results captured against a task
  stay attached to it.
* **A closed study refuses changes** until it is reopened (``update_study``
  with ``status="open"``, the one write a closed study takes).

A person signed in as an organisation admin reaches them too (``data:write``),
which is what a board token also carries -- only an admin can mint one.
"""
import base64
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security.scope_context import ScopeContext

from ..common import get_project, require_studio_permission
from . import content as rules
from .models import Study, StudyFile
from .routes import (
    BASE,
    _capture,
    _change_observation,
    _change_participant,
    _clone,
    _export,
    _file_out,
    _files,
    _insights,
    _new_observation,
    _new_participant,
    _new_study,
    _observation_out,
    _organisation_name,
    _participant,
    _participant_out,
    _participants,
    _result_out,
    _results,
    _save_file,
    _set_content,
    _study,
)
from .schemas import (
    AgentCaptureWrite,
    AgentObservationWrite,
    AgentParticipantWrite,
    AgentStudyCreate,
    AgentStudyImport,
    AgentStudyPatch,
    AgentTaskOrder,
    AgentTaskPatch,
    AgentTasksIn,
    StudyClone,
    StudyContent,
    StudyFileIn,
)

router = APIRouter()

AGENT = f"{BASE}/agent"

#: Never returned to an agent (see the module docstring).
SECRET_PARTICIPANT_FIELDS = ("token", "account_password")


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
    """The study as an agent sees it: its details and its whole content. Who
    takes part is read separately (``list_participants``)."""
    content = rules.with_defaults(study.content)
    return {
        **_summary(study),
        "research_questions": content.get("research_questions", []),
        "protocol": content.get("protocol", []),
        "consent_title": content.get("consent_title", ""),
        "consent_text": content.get("consent_text", []),
        "consent_version": study.consent_version,
        "sign_up": content["sign_up"],
        "sign_up_text": content["sign_up_text"],
        "tasks": content.get("tasks", []),
        "script": content.get("script", {}),
        "words": content.get("words", []),
        "top_words": content.get("top_words", rules.TOP_WORDS),
        "files": [_file_out(f) for f in await _files(db, study)],
    }


def _participant_view(out: dict[str, Any]) -> dict[str, Any]:
    """A participant as the editor shows them, less the link token and the
    test account password; whether a password is set is kept."""
    view = {k: v for k, v in out.items() if k not in SECRET_PARTICIPANT_FIELDS}
    view["account_password_set"] = bool(out.get("account_password"))
    return view


def _open(study: Study) -> Study:
    if study.status != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This study is closed. Reopen it first (update_study with status open).",
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


# ── studies ─────────────────────────────────────────────────────────────────


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


@router.post(f"{AGENT}/studies/import", status_code=status.HTTP_201_CREATED)
async def import_usability_study_for_agent(
    project_id: UUID,
    payload: AgentStudyImport,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A new study from an exported study document (content and files), as
    Import study does in Studio."""
    project = await get_project(db, project_id, ctx)
    study = await _new_study(db, project, payload, ctx.user_id)
    out = await _out(db, study)
    await db.commit()
    return out


@router.patch(f"{AGENT}/studies/{{study_id}}")
async def update_usability_study_for_agent(
    project_id: UUID,
    study_id: UUID,
    payload: AgentStudyPatch,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Change the fields sent. A closed study takes only ``status="open"``
    (with anything else in the same call applied after it reopens); closing
    applies the other fields first."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    sent = payload.model_fields_set - {"status"}
    if payload.status == "open":
        study.status = "open"
    if sent:
        _open(study)
    if "name" in sent and payload.name is not None:
        study.name = payload.name
    for name in ("persona", "duration", "app_url"):
        if name in sent:
            setattr(study, name, getattr(payload, name) or None)
    content = dict(study.content or {})
    for name in ("research_questions", "protocol", "consent_title", "consent_text", "sign_up", "sign_up_text",
                 "words", "top_words"):
        if name in sent and getattr(payload, name) is not None:
            content[name] = getattr(payload, name)
    if "script" in sent and payload.script is not None:
        sections = payload.script.model_dump(exclude_unset=True, exclude_none=True)
        content["script"] = {**(content.get("script") or {}), **sections}
    _set_content(study, StudyContent.model_validate(content).model_dump())
    if payload.status == "closed":
        study.status = "closed"
    await db.flush()
    out = await _out(db, study)
    await db.commit()
    return out


@router.post(f"{AGENT}/studies/{{study_id}}/clone", status_code=status.HTTP_201_CREATED)
async def clone_usability_study_for_agent(
    project_id: UUID,
    study_id: UUID,
    payload: StudyClone,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A new open study with this one's content and files and nobody in it.
    A closed study may be cloned: that is how a finished round is rerun."""
    project = await get_project(db, project_id, ctx)
    clone = await _clone(db, await _study(db, project, study_id), payload.name, ctx.user_id)
    out = await _out(db, clone)
    await db.commit()
    return out


@router.get(f"{AGENT}/studies/{{study_id}}/export")
async def export_usability_study_for_agent(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The study's content and files as one document the import route takes
    back. Holds nothing of a participant."""
    project = await get_project(db, project_id, ctx)
    return await _export(db, await _study(db, project, study_id))


# ── tasks ───────────────────────────────────────────────────────────────────


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


@router.post(f"{AGENT}/studies/{{study_id}}/tasks/order")
async def reorder_usability_tasks(
    project_id: UUID,
    study_id: UUID,
    payload: AgentTaskOrder,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Put the tasks in a new order. Every id must be named once, so a
    reorder can never drop a task."""
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    content = dict(study.content or {})
    tasks = {task["id"]: task for task in content.get("tasks", [])}
    if len(payload.task_ids) != len(set(payload.task_ids)) or set(payload.task_ids) != set(tasks):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Name every task id once, and only those; this study has {sorted(tasks)}",
        )
    content["tasks"] = [tasks[task_id] for task_id in payload.task_ids]
    study.content = StudyContent.model_validate(content).model_dump()
    await db.flush()
    out = await _out(db, study)
    await db.commit()
    return out


# ── files ───────────────────────────────────────────────────────────────────


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


@router.get(f"{AGENT}/studies/{{study_id}}/files/{{file_id}}")
async def download_usability_file_for_agent(
    project_id: UUID,
    study_id: UUID,
    file_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One file's bytes, base64 in JSON: the MCP server saves them locally."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    f = (
        await db.execute(
            select(StudyFile).where(
                StudyFile.id == file_id, StudyFile.study_id == study.id, StudyFile.account_id == study.account_id
            )
        )
    ).scalar_one_or_none()
    if f is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return {**_file_out(f), "data_base64": base64.b64encode(f.data).decode("ascii")}


# ── participants and observation capture ───────────────────────────────────


@router.get(f"{AGENT}/studies/{{study_id}}/participants")
async def list_usability_participants_for_agent(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    people = await _participants(db, study)
    results = await _results(db, study, [p.id for p in people])
    return [_participant_view(_participant_out(study, p, results[p.id])) for p in people]


@router.post(f"{AGENT}/studies/{{study_id}}/participants", status_code=status.HTTP_201_CREATED)
async def add_usability_participant_for_agent(
    project_id: UUID,
    study_id: UUID,
    payload: AgentParticipantWrite,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add a participant and mint their link. Nothing is sent to them, and the
    link is not returned: a person copies it from Studio."""
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    participant = await _new_participant(db, study, payload)
    out = _participant_view(_participant_out(study, participant, {}))
    await db.commit()
    return out


@router.get(f"{AGENT}/studies/{{study_id}}/participants/{{participant_id}}")
async def get_usability_capture_for_agent(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One participant's observation capture: every task, filled in or not."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    participant = await _participant(db, study, participant_id)
    results = (await _results(db, study, [participant.id]))[participant.id]
    return {
        **_participant_view(_participant_out(study, participant, results)),
        "tasks": [_result_out(task_id, results.get(task_id)) for task_id in rules.task_ids(study.content)],
    }


@router.patch(f"{AGENT}/studies/{{study_id}}/participants/{{participant_id}}")
async def update_usability_participant_for_agent(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    payload: AgentParticipantWrite,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    participant = await _participant(db, study, participant_id)
    _change_participant(participant, payload)
    await db.flush()
    results = (await _results(db, study, [participant.id]))[participant.id]
    out = _participant_view(_participant_out(study, participant, results))
    await db.commit()
    return out


@router.patch(f"{AGENT}/studies/{{study_id}}/participants/{{participant_id}}/tasks/{{task_id}}")
async def capture_usability_task_for_agent(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    task_id: str,
    payload: AgentCaptureWrite,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The moderator's half of one task for one participant: only the fields
    sent change."""
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    participant = await _participant(db, study, participant_id)
    out = await _capture(db, study, participant, task_id, payload)
    await db.commit()
    return out


# ── insights ────────────────────────────────────────────────────────────────


@router.get(f"{AGENT}/studies/{{study_id}}/insights")
async def get_usability_insights_for_agent(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The same as Study insights shows; it carries no link or password."""
    project = await get_project(db, project_id, ctx)
    return await _insights(db, await _study(db, project, study_id))


@router.post(f"{AGENT}/studies/{{study_id}}/observations", status_code=status.HTTP_201_CREATED)
async def add_usability_observation_for_agent(
    project_id: UUID,
    study_id: UUID,
    payload: AgentObservationWrite,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    out = _observation_out(await _new_observation(db, study, payload))
    await db.commit()
    return out


@router.patch(f"{AGENT}/studies/{{study_id}}/observations/{{observation_id}}")
async def update_usability_observation_for_agent(
    project_id: UUID,
    study_id: UUID,
    observation_id: UUID,
    payload: AgentObservationWrite,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = _open(await _study(db, project, study_id))
    out = _observation_out(await _change_observation(db, study, observation_id, payload))
    await db.commit()
    return out
