"""Usability study routes.

Two groups:

* ``/studio/projects/{project_id}/usability/...`` -- the organisation's side:
  the study and its content, its participants, each participant's observation
  capture, and the study's insights. Every route needs ``data:write``, reads
  included: only organisation admins run studies, and a participant's row
  holds a test account's password.

* ``/studio/usability/session/{token}/...`` -- the participant page. A
  participant has no account, so there is no bearer token and no scope header;
  holding the link is the proof, as with an invitation. The token names one
  participant row, and the organisation is adopted from that row
  (``_session``), so row-level security still confines every statement to it.
  Until consent is given the only thing returned is the protocol and the
  consent form.

None of the write routes takes the project lock: a round of testing is live
state on the project's lineage, like the board, not part of a design version.
"""
import base64
import binascii
import secrets
from collections import Counter
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.models.tenant import Tenant
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from ..common import adopt_account_scope, allow_cross_account, get_project
from ..models import Project, utc_now
from . import content as rules
from .models import Observation, Participant, Study, StudyFile, TaskResult
from .schemas import (
    MAX_FILE_BYTES,
    CaptureWrite,
    ConsentIn,
    ObservationWrite,
    ParticipantWrite,
    StudyClone,
    StudyContent,
    StudyCreate,
    StudyFileIn,
    StudyUpdate,
    TaskAnswerIn,
    WordsIn,
)

router = APIRouter()
public_router = APIRouter(prefix="/usability/session")

BASE = "/projects/{project_id}/usability"


# ── lookups ─────────────────────────────────────────────────────────────────


async def _study(db: AsyncSession, project: Project, study_id: UUID) -> Study:
    study = (
        await db.execute(
            select(Study).where(
                Study.id == study_id, Study.account_id == project.account_id, Study.lineage_id == project.lineage_id
            )
        )
    ).scalar_one_or_none()
    if study is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study not found")
    return study


async def _participant(db: AsyncSession, study: Study, participant_id: UUID) -> Participant:
    participant = (
        await db.execute(
            select(Participant).where(
                Participant.id == participant_id,
                Participant.study_id == study.id,
                Participant.account_id == study.account_id,
            )
        )
    ).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    return participant


async def _participants(db: AsyncSession, study: Study) -> list[Participant]:
    rows = await db.execute(
        select(Participant)
        .where(Participant.study_id == study.id, Participant.account_id == study.account_id)
        .order_by(Participant.created_at.asc(), Participant.code.asc())
    )
    return list(rows.scalars().all())


async def _results(db: AsyncSession, study: Study, participant_ids: list[UUID]) -> dict[UUID, dict[str, TaskResult]]:
    out: dict[UUID, dict[str, TaskResult]] = {pid: {} for pid in participant_ids}
    if participant_ids:
        rows = await db.execute(
            select(TaskResult).where(
                TaskResult.participant_id.in_(participant_ids), TaskResult.account_id == study.account_id
            )
        )
        for row in rows.scalars():
            out[row.participant_id][row.task_id] = row
    return out


async def _result_row(db: AsyncSession, participant: Participant, task_id: str) -> TaskResult:
    row = (
        await db.execute(
            select(TaskResult).where(
                TaskResult.participant_id == participant.id,
                TaskResult.task_id == task_id,
                TaskResult.account_id == participant.account_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = TaskResult(account_id=participant.account_id, participant_id=participant.id, task_id=task_id)
        db.add(row)
    return row


async def _files(db: AsyncSession, study: Study) -> list[StudyFile]:
    rows = await db.execute(
        select(StudyFile)
        .where(StudyFile.study_id == study.id, StudyFile.account_id == study.account_id)
        .order_by(StudyFile.name.asc())
    )
    return list(rows.scalars().all())


# ── shapes ──────────────────────────────────────────────────────────────────


def _result_out(task_id: str, row: TaskResult | None) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "rating": row.rating if row else None,
        "answer": (row.answer if row else None) or "",
        "time_seconds": row.time_seconds if row else None,
        "errors": row.errors if row else None,
        "success": row.success if row else None,
        "observations": (row.observations if row else None) or "",
    }


def _progress(study: Study, participant: Participant, results: dict[str, TaskResult]) -> dict[str, Any]:
    ids = rules.task_ids(study.content)
    rated = sum(1 for task_id in ids if task_id in results and results[task_id].rating is not None)
    return {
        "consented": participant.consent_at is not None,
        "tasks_rated": rated,
        "tasks_total": len(ids),
        "completed": participant.completed_at is not None,
    }


def _participant_out(study: Study, p: Participant, results: dict[str, TaskResult]) -> dict[str, Any]:
    return {
        "id": p.id,
        "study_id": p.study_id,
        "code": p.code,
        "token": p.token,
        "scheduled_at": p.scheduled_at or "",
        "role": p.role or "",
        "company": p.company or "",
        "characteristics": p.characteristics or "",
        "app_url": p.app_url or "",
        "account_email": p.account_email or "",
        "account_password": p.account_password or "",
        "account_notes": p.account_notes or "",
        "consent_name": p.consent_name,
        "consent_at": p.consent_at,
        "words": p.words or [],
        "top_words": p.top_words or [],
        "completed_at": p.completed_at,
        "session_notes": p.session_notes or "",
        "progress": _progress(study, p, results),
    }


def _file_out(f: StudyFile) -> dict[str, Any]:
    return {"id": f.id, "name": f.name, "content_type": f.content_type, "size": f.size}


def _study_summary(study: Study, participants: int, completed: int) -> dict[str, Any]:
    return {
        "id": study.id,
        "name": study.name,
        "status": study.status,
        "persona": study.persona or "",
        "duration": study.duration or "",
        "app_url": study.app_url or "",
        "task_count": len(study.content.get("tasks", [])),
        "participants": participants,
        "completed": completed,
        "created_at": study.created_at,
        "updated_at": study.updated_at,
    }


def _decode(file: StudyFileIn) -> bytes:
    try:
        data = base64.b64decode(file.data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{file.name} is not valid base64")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{file.name} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB",
        )
    return data


async def _organisation_name(db: AsyncSession, account_id: UUID) -> str:
    name = (await db.execute(select(Tenant.name).where(Tenant.id == account_id))).scalar_one_or_none()
    return name or "the study team"


# ── studies ─────────────────────────────────────────────────────────────────


@router.get(f"{BASE}/studies")
async def list_usability_studies(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
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
    counts = {
        study_id: (total, done)
        for study_id, total, done in (
            await db.execute(
                select(Participant.study_id, func.count(Participant.id), func.count(Participant.completed_at))
                .where(Participant.account_id == project.account_id)
                .group_by(Participant.study_id)
            )
        ).all()
    }
    return [_study_summary(s, *counts.get(s.id, (0, 0))) for s in studies]


async def _study_detail(db: AsyncSession, study: Study) -> dict[str, Any]:
    people = await _participants(db, study)
    results = await _results(db, study, [p.id for p in people])
    done = sum(1 for p in people if p.completed_at is not None)
    return {
        **_study_summary(study, len(people), done),
        "content": study.content,
        "consent_version": study.consent_version,
        "files": [_file_out(f) for f in await _files(db, study)],
        "participant_list": [_participant_out(study, p, results[p.id]) for p in people],
    }


@router.post(f"{BASE}/studies", status_code=status.HTTP_201_CREATED)
async def create_usability_study(
    project_id: UUID,
    payload: StudyCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A blank study with the default protocol, consent form and script, or --
    when ``content`` is given -- one imported from an exported study file."""
    project = await get_project(db, project_id, ctx)
    study = await _new_study(db, project, payload, ctx.user_id)
    out = await _study_detail(db, study)
    await db.commit()
    return out


async def _new_study(db: AsyncSession, project: Project, payload: StudyCreate, user_id: UUID) -> Study:
    if payload.content is not None:
        content = payload.content.model_dump()
    else:
        content = rules.default_content(await _organisation_name(db, project.account_id))
    study = Study(
        account_id=project.account_id,
        lineage_id=project.lineage_id,
        name=payload.name,
        persona=payload.persona,
        duration=payload.duration,
        app_url=payload.app_url,
        content=content,
        created_by=user_id,
    )
    db.add(study)
    await db.flush()
    names: set[str] = set()
    for file in payload.files:
        if file.name in names:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Two files are called {file.name}")
        names.add(file.name)
        data = _decode(file)
        db.add(
            StudyFile(
                account_id=study.account_id, study_id=study.id, name=file.name,
                content_type=file.content_type or "application/octet-stream", size=len(data), data=data,
            )
        )
    await db.flush()
    return study


def _set_content(study: Study, new_content: dict[str, Any]) -> None:
    """Replace the study's content. A participant keeps the wording they
    agreed to, so any change to the consent form is a new version of it."""
    old = study.content or {}
    if (new_content["consent_title"], new_content["consent_text"]) != (
        old.get("consent_title"), old.get("consent_text"),
    ):
        study.consent_version = (study.consent_version or 1) + 1
    study.content = new_content


@router.get(f"{BASE}/studies/{{study_id}}")
async def get_usability_study(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    return await _study_detail(db, await _study(db, project, study_id))


@router.patch(f"{BASE}/studies/{{study_id}}")
async def update_usability_study(
    project_id: UUID,
    study_id: UUID,
    payload: StudyUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    sent = payload.model_fields_set
    for field_name in ("name", "status"):
        if field_name in sent and getattr(payload, field_name) is not None:
            setattr(study, field_name, getattr(payload, field_name))
    for field_name in ("persona", "duration", "app_url"):
        if field_name in sent:
            setattr(study, field_name, getattr(payload, field_name) or None)
    if "content" in sent and payload.content is not None:
        _set_content(study, payload.content.model_dump())
    await db.flush()
    out = await _study_detail(db, study)
    await db.commit()
    return out


@router.delete(f"{BASE}/studies/{{study_id}}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_usability_study(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Deletes the study with its files, participants, captures and
    observations (they cascade)."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    await db.delete(study)
    await db.commit()


@router.post(f"{BASE}/studies/{{study_id}}/clone", status_code=status.HTTP_201_CREATED)
async def clone_usability_study(
    project_id: UUID,
    study_id: UUID,
    payload: StudyClone,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A new study with this one's content and files and nobody in it: its
    participants, captures and observations belong to the round they came from."""
    project = await get_project(db, project_id, ctx)
    clone = await _clone(db, await _study(db, project, study_id), payload.name, ctx.user_id)
    out = await _study_detail(db, clone)
    await db.commit()
    return out


async def _clone(db: AsyncSession, source: Study, name: str | None, user_id: UUID) -> Study:
    clone = Study(
        account_id=source.account_id,
        lineage_id=source.lineage_id,
        name=name or f"{source.name} (copy)",
        persona=source.persona,
        duration=source.duration,
        app_url=source.app_url,
        content=StudyContent.model_validate(source.content).model_dump(),
        created_by=user_id,
    )
    db.add(clone)
    await db.flush()
    for f in await _files(db, source):
        db.add(
            StudyFile(
                account_id=clone.account_id, study_id=clone.id, name=f.name,
                content_type=f.content_type, size=f.size, data=f.data,
            )
        )
    await db.flush()
    return clone


@router.get(f"{BASE}/studies/{{study_id}}/export")
async def export_usability_study(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The study's content and files as one document ``create_usability_study``
    accepts back -- to keep in a repository, or to carry to another project."""
    project = await get_project(db, project_id, ctx)
    return await _export(db, await _study(db, project, study_id))


async def _export(db: AsyncSession, study: Study) -> dict[str, Any]:
    return {
        "name": study.name,
        "persona": study.persona,
        "duration": study.duration,
        "app_url": study.app_url,
        "content": study.content,
        "files": [
            {"name": f.name, "content_type": f.content_type, "data_base64": base64.b64encode(f.data).decode("ascii")}
            for f in await _files(db, study)
        ],
    }


# ── files ───────────────────────────────────────────────────────────────────


@router.post(f"{BASE}/studies/{{study_id}}/files", status_code=status.HTTP_201_CREATED)
async def upload_usability_file(
    project_id: UUID,
    study_id: UUID,
    payload: StudyFileIn,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add a file, or replace the one of the same name."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    out = _file_out(await _save_file(db, study, payload))
    await db.commit()
    return out


async def _save_file(db: AsyncSession, study: Study, payload: StudyFileIn) -> StudyFile:
    data = _decode(payload)
    existing = (
        await db.execute(
            select(StudyFile).where(
                StudyFile.study_id == study.id, StudyFile.account_id == study.account_id, StudyFile.name == payload.name
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = StudyFile(account_id=study.account_id, study_id=study.id, name=payload.name, size=0, data=b"")
        db.add(existing)
    existing.content_type = payload.content_type or "application/octet-stream"
    existing.size = len(data)
    existing.data = data
    await db.flush()
    return existing


def _download(f: StudyFile) -> Response:
    # A fixed, non-rendering type and an attachment disposition: an uploaded
    # file is handed back as a download, never shown as a page on this origin.
    quoted = f.name.replace("\\", "").replace('"', "")
    return Response(
        content=f.data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{quoted}"', "X-Content-Type-Options": "nosniff"},
    )


@router.get(f"{BASE}/studies/{{study_id}}/files/{{file_id}}")
async def download_usability_file(
    project_id: UUID,
    study_id: UUID,
    file_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
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
    return _download(f)


@router.delete(f"{BASE}/studies/{{study_id}}/files/{{file_id}}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_usability_file(
    project_id: UUID,
    study_id: UUID,
    file_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    await db.execute(
        delete(StudyFile).where(
            StudyFile.id == file_id, StudyFile.study_id == study.id, StudyFile.account_id == study.account_id
        )
    )
    await db.commit()


# ── participants ────────────────────────────────────────────────────────────

_PARTICIPANT_FIELDS = (
    "scheduled_at", "role", "company", "characteristics", "app_url",
    "account_email", "account_password", "account_notes", "session_notes",
)


@router.post(f"{BASE}/studies/{{study_id}}/participants", status_code=status.HTTP_201_CREATED)
async def add_usability_participant(
    project_id: UUID,
    study_id: UUID,
    payload: ParticipantWrite,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add a participant and mint their link. Nothing is sent to them."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    participant = await _new_participant(db, study, payload)
    out = _participant_out(study, participant, {})
    await db.commit()
    return out


async def _new_participant(db: AsyncSession, study: Study, payload: ParticipantWrite) -> Participant:
    study.participant_seq = (study.participant_seq or 0) + 1
    participant = Participant(
        account_id=study.account_id,
        study_id=study.id,
        code=f"P{study.participant_seq}",
        token=secrets.token_urlsafe(32),
        app_url=study.app_url,
    )
    for field_name in payload.model_fields_set:
        setattr(participant, field_name, getattr(payload, field_name))
    db.add(participant)
    await db.flush()
    return participant


def _change_participant(participant: Participant, payload: ParticipantWrite) -> None:
    for field_name in payload.model_fields_set:
        if field_name in _PARTICIPANT_FIELDS:
            setattr(participant, field_name, getattr(payload, field_name))


@router.get(f"{BASE}/studies/{{study_id}}/participants/{{participant_id}}")
async def get_usability_participant(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One participant's observation capture: every task, filled in or not."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    participant = await _participant(db, study, participant_id)
    results = (await _results(db, study, [participant.id]))[participant.id]
    return {
        **_participant_out(study, participant, results),
        "tasks": [_result_out(task_id, results.get(task_id)) for task_id in rules.task_ids(study.content)],
    }


@router.patch(f"{BASE}/studies/{{study_id}}/participants/{{participant_id}}")
async def update_usability_participant(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    payload: ParticipantWrite,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    participant = await _participant(db, study, participant_id)
    _change_participant(participant, payload)
    await db.flush()
    out = _participant_out(study, participant, (await _results(db, study, [participant.id]))[participant.id])
    await db.commit()
    return out


@router.delete(f"{BASE}/studies/{{study_id}}/participants/{{participant_id}}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_usability_participant(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove the participant and what was captured for them, and take them
    off every observation they were marked against. Their link stops working."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    participant = await _participant(db, study, participant_id)
    gone = str(participant.id)
    observations = await db.execute(
        select(Observation).where(Observation.study_id == study.id, Observation.account_id == study.account_id)
    )
    for observation in observations.scalars():
        if gone in (observation.participant_ids or []):
            observation.participant_ids = [pid for pid in observation.participant_ids if pid != gone]
    await db.delete(participant)
    await db.commit()


@router.put(f"{BASE}/studies/{{study_id}}/participants/{{participant_id}}/tasks/{{task_id}}")
async def capture_usability_task(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    task_id: str,
    payload: CaptureWrite,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    participant = await _participant(db, study, participant_id)
    out = await _capture(db, study, participant, task_id, payload)
    await db.commit()
    return out


async def _capture(
    db: AsyncSession, study: Study, participant: Participant, task_id: str, payload: CaptureWrite
) -> dict[str, Any]:
    if task_id not in rules.task_ids(study.content):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such task in this study")
    row = await _result_row(db, participant, task_id)
    for field_name in payload.model_fields_set:
        setattr(row, field_name, getattr(payload, field_name))
    await db.flush()
    return _result_out(task_id, row)


# ── insights ────────────────────────────────────────────────────────────────


def _observation_out(observation: Observation) -> dict[str, Any]:
    return {
        "id": observation.id,
        "task_id": observation.task_id,
        "text": observation.text,
        "solution": observation.solution or "",
        "notes": observation.notes or "",
        "participant_ids": observation.participant_ids or [],
    }


@router.get(f"{BASE}/studies/{{study_id}}/insights")
async def get_usability_insights(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The study as the rainbow spreadsheet shows it: observations against
    participants, the measures for every participant and task with their
    averages, and how often each word was chosen."""
    project = await get_project(db, project_id, ctx)
    return await _insights(db, await _study(db, project, study_id))


async def _insights(db: AsyncSession, study: Study) -> dict[str, Any]:
    people = await _participants(db, study)
    results = await _results(db, study, [p.id for p in people])
    observations = (
        await db.execute(
            select(Observation)
            .where(Observation.study_id == study.id, Observation.account_id == study.account_id)
            .order_by(Observation.created_at.asc())
        )
    ).scalars().all()

    metrics = []
    for task in study.content.get("tasks", []):
        rows = [{"participant_id": p.id, **_result_out(task["id"], results[p.id].get(task["id"]))} for p in people]
        scores = [rules.success_score(r["success"]) for r in rows]
        metrics.append(
            {
                "task_id": task["id"],
                "title": task.get("title", ""),
                "rows": rows,
                "success": rules.stats([s for s in scores if s is not None]),
                "time_seconds": rules.stats([float(r["time_seconds"]) for r in rows if r["time_seconds"] is not None]),
                "errors": rules.stats([float(r["errors"]) for r in rows if r["errors"] is not None]),
                "rating": rules.stats([float(r["rating"]) for r in rows if r["rating"] is not None]),
            }
        )

    chosen: Counter[str] = Counter()
    top: Counter[str] = Counter()
    for p in people:
        chosen.update(p.words or [])
        top.update(p.top_words or [])
    words = sorted(
        ({"word": word, "chosen": n, "top": top.get(word, 0)} for word, n in chosen.items()),
        key=lambda w: (-w["top"], -w["chosen"], w["word"]),
    )

    return {
        "research_questions": study.content.get("research_questions", []),
        "tasks": [{"id": t["id"], "title": t.get("title", "")} for t in study.content.get("tasks", [])],
        "participants": [
            {"id": p.id, "code": p.code, "role": p.role or "", "company": p.company or "",
             "completed": p.completed_at is not None}
            for p in people
        ],
        "observations": [_observation_out(o) for o in observations],
        "metrics": metrics,
        "words": words,
    }


async def _check_observation(db: AsyncSession, study: Study, payload: ObservationWrite) -> None:
    sent = payload.model_fields_set
    if "task_id" in sent and payload.task_id is not None and payload.task_id not in rules.task_ids(study.content):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No such task in this study")
    if "participant_ids" in sent and payload.participant_ids:
        known = {p.id for p in await _participants(db, study)}
        if not set(payload.participant_ids) <= known:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Every participant must belong to this study"
            )


def _id_strings(ids: list[UUID] | None) -> list[str]:
    return sorted({str(i) for i in ids or []})


@router.post(f"{BASE}/studies/{{study_id}}/observations", status_code=status.HTTP_201_CREATED)
async def add_usability_observation(
    project_id: UUID,
    study_id: UUID,
    payload: ObservationWrite,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    out = _observation_out(await _new_observation(db, study, payload))
    await db.commit()
    return out


async def _new_observation(db: AsyncSession, study: Study, payload: ObservationWrite) -> Observation:
    if not payload.text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Say what was observed")
    await _check_observation(db, study, payload)
    observation = Observation(
        account_id=study.account_id,
        study_id=study.id,
        task_id=payload.task_id,
        text=payload.text,
        solution=payload.solution,
        notes=payload.notes,
        participant_ids=_id_strings(payload.participant_ids),
    )
    db.add(observation)
    await db.flush()
    return observation


@router.patch(f"{BASE}/studies/{{study_id}}/observations/{{observation_id}}")
async def update_usability_observation(
    project_id: UUID,
    study_id: UUID,
    observation_id: UUID,
    payload: ObservationWrite,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    out = _observation_out(await _change_observation(db, study, observation_id, payload))
    await db.commit()
    return out


async def _change_observation(
    db: AsyncSession, study: Study, observation_id: UUID, payload: ObservationWrite
) -> Observation:
    observation = (
        await db.execute(
            select(Observation).where(
                Observation.id == observation_id,
                Observation.study_id == study.id,
                Observation.account_id == study.account_id,
            )
        )
    ).scalar_one_or_none()
    if observation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Observation not found")
    await _check_observation(db, study, payload)
    sent = payload.model_fields_set
    if "text" in sent:
        if not payload.text:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Say what was observed")
        observation.text = payload.text
    if "task_id" in sent:
        observation.task_id = payload.task_id
    if "solution" in sent:
        observation.solution = payload.solution
    if "notes" in sent:
        observation.notes = payload.notes
    if "participant_ids" in sent:
        observation.participant_ids = _id_strings(payload.participant_ids)
    await db.flush()
    return observation


@router.delete(f"{BASE}/studies/{{study_id}}/observations/{{observation_id}}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_usability_observation(
    project_id: UUID,
    study_id: UUID,
    observation_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    await db.execute(
        delete(Observation).where(
            Observation.id == observation_id, Observation.study_id == study.id, Observation.account_id == study.account_id
        )
    )
    await db.commit()


# ── the participant page: no sign-in, the token is the proof ────────────────


async def _session(db: AsyncSession, token: str, *, consented: bool = False) -> tuple[Participant, Study]:
    """The participant and study a link names, with this transaction confined
    to their organisation.

    The link carries no organisation, so the participant is first found across
    all of them; from then on the transaction runs as that one organisation
    only (``adopt_account_scope`` also drops the cross-account read), so
    nothing after this line can touch another organisation's rows. Both
    settings are transaction-local: a route must do all its work before its
    one commit.

    A link to a closed study stops working, so a finished round cannot be
    reopened from an old message.
    """
    await allow_cross_account(db)
    participant = (await db.execute(select(Participant).where(Participant.token == token))).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This link is not valid")
    await adopt_account_scope(db, participant.account_id)
    study = (
        await db.execute(
            select(Study).where(Study.id == participant.study_id, Study.account_id == participant.account_id)
        )
    ).scalar_one_or_none()
    if study is None or study.status != "open":
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This study has closed")
    if consented and participant.consent_at is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Consent has not been given yet")
    return participant, study


async def _session_out(db: AsyncSession, participant: Participant, study: Study) -> dict[str, Any]:
    content = study.content or {}
    out: dict[str, Any] = {
        "title": study.name,
        "organisation": await _organisation_name(db, study.account_id),
        "duration": study.duration or "",
        "code": participant.code,
        "protocol": content.get("protocol", []),
        "consent": {
            "title": content.get("consent_title", ""),
            "text": content.get("consent_text", []),
            "given": participant.consent_at is not None,
            "name": participant.consent_name,
            "at": participant.consent_at,
        },
    }
    if participant.consent_at is None:
        return out
    results = (await _results(db, study, [participant.id]))[participant.id]
    available = {f.name for f in await _files(db, study)}
    tasks = []
    for task in rules.participant_content(content)["tasks"]:
        row = results.get(task["id"])
        tasks.append(
            {
                **task,
                # a task may name a file that was never uploaded; do not offer a dead link
                "files": [name for name in task["files"] if name in available],
                "rating": row.rating if row else None,
                "answer": (row.answer if row else None) or "",
            }
        )
    out.update(
        {
            "account": {
                "app_url": participant.app_url or "",
                "email": participant.account_email or "",
                "password": participant.account_password or "",
                "notes": participant.account_notes or "",
            },
            "tasks": tasks,
            "word_list": content.get("words", []),
            "top_words_count": content.get("top_words", rules.TOP_WORDS),
            "words": participant.words or [],
            "top_words": participant.top_words or [],
            "completed": participant.completed_at is not None,
        }
    )
    return out


@public_router.get("/{token}", include_in_schema=False)
async def usability_session(token: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    participant, study = await _session(db, token)
    return await _session_out(db, participant, study)


@public_router.post("/{token}/consent", include_in_schema=False)
async def usability_session_consent(token: str, payload: ConsentIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    participant, study = await _session(db, token)
    if participant.consent_at is None:  # given once: a second submit changes nothing
        participant.consent_name = payload.name
        participant.consent_at = utc_now()
        participant.consent_version = study.consent_version
        await db.flush()
    out = await _session_out(db, participant, study)
    await db.commit()
    return out


@public_router.put("/{token}/tasks/{task_id}", include_in_schema=False)
async def usability_session_task(
    token: str, task_id: str, payload: TaskAnswerIn, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    participant, study = await _session(db, token, consented=True)
    if task_id not in rules.task_ids(study.content):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such task")
    row = await _result_row(db, participant, task_id)
    if "rating" in payload.model_fields_set:
        row.rating = payload.rating
    if "answer" in payload.model_fields_set:
        row.answer = payload.answer
    await db.flush()
    out = {"task_id": task_id, "rating": row.rating, "answer": row.answer or ""}
    await db.commit()
    return out


@public_router.put("/{token}/words", include_in_schema=False)
async def usability_session_words(token: str, payload: WordsIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    participant, study = await _session(db, token, consented=True)
    words, top = rules.clean_words(payload.words, payload.top_words, study.content)
    limit = study.content.get("top_words", rules.TOP_WORDS)
    if len(top) > limit:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Choose at most {limit} words")
    participant.words, participant.top_words = words, top
    await db.commit()
    return {"words": words, "top_words": top}


@public_router.post("/{token}/complete", include_in_schema=False)
async def usability_session_complete(token: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    participant, _study_row = await _session(db, token, consented=True)
    if participant.completed_at is None:
        participant.completed_at = utc_now()
    await db.commit()
    return {"completed": True}


@public_router.get("/{token}/files/{name}", include_in_schema=False)
async def usability_session_file(token: str, name: str, db: AsyncSession = Depends(get_db)) -> Response:
    participant, study = await _session(db, token, consented=True)
    if name not in rules.listed_files(study.content):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such file")
    f = (
        await db.execute(
            select(StudyFile).where(
                StudyFile.study_id == study.id, StudyFile.account_id == participant.account_id, StudyFile.name == name
            )
        )
    ).scalar_one_or_none()
    if f is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such file")
    return _download(f)
