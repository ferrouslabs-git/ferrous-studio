"""Developer annotations on wireframe nodes: notes and tasks.

A *note* is a flat informational record; a *task* additionally carries the
resolve lifecycle (``resolved_at``/``resolved_by``, null = open). Both pin to
one node of a page -- a region, a component, or an element -- addressed by the
document's own ids. Anyone with ``data:write`` may edit, delete, resolve or
reopen any annotation; accountability comes from the audit log, which records
every mutation (see ``audit.py``).

``tasks:create`` is the one crack in an otherwise read-only organisation
member's access: it authorises creating an annotation of kind "task" here and
nothing else. Notes, and every later change to a task, still need
``data:write``.

Annotations deliberately live outside the page-document op system: they are
per-user-attributed metadata, not document content, so they do not participate
in undo, snapshots, or conflict detection. A target that later disappears
leaves the annotation orphaned (shown as such by the client), matching how
``remove`` ops never cascade related data.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.models.user import User
from app.auth.security import require_any_permission, require_permission
from app.auth.security.scope_context import ScopeContext

from .audit import record_event
from .common import get_project, get_wireframe, get_wireframe_page
from .models import Wireframe, WireframeAnnotation, utc_now
from .ops import tree_region_ids
from .schemas import AnnotationCreate, AnnotationRead, AnnotationUpdate

router = APIRouter()


def find_annotation_target(
    document: dict[str, Any] | None, target_kind: str, target_id: str, target_cmp_id: str | None
) -> bool:
    """Does the node an annotation points at exist in this page document?

    Regions are checked against the layout tree (which is authoritative --
    a stale ``regions`` key alone does not count), components against every
    region list, and elements against their owning component's ``elements``.
    Element ids are bare document ids, never the frontend's ``el:`` address.
    """
    doc = document or {}
    if target_kind == "region":
        return target_id in tree_region_ids(doc.get("root"))
    regions = doc.get("regions") or {}
    if not isinstance(regions, dict):
        return False
    components = [
        c for items in regions.values() if isinstance(items, list) for c in items if isinstance(c, dict)
    ]
    if target_kind == "cmp":
        return any(c.get("id") == target_id for c in components)
    if target_kind == "element":
        if not target_cmp_id or target_id.startswith("el:"):
            return False
        for c in components:
            if c.get("id") == target_cmp_id:
                elements = c.get("elements") or []
                return any(isinstance(el, dict) and el.get("id") == target_id for el in elements)
    return False


def _read(
    annotation: WireframeAnnotation,
    author: User | None = None,
    resolver: User | None = None,
) -> AnnotationRead:
    return AnnotationRead.model_validate(annotation).model_copy(
        update={
            "author_name": author.name if author else None,
            "author_email": author.email if author else None,
            "resolver_name": resolver.name if resolver else None,
            "resolver_email": resolver.email if resolver else None,
        }
    )


async def _read_one(db: AsyncSession, annotation: WireframeAnnotation) -> AnnotationRead:
    author = await db.get(User, annotation.created_by) if annotation.created_by else None
    resolver = await db.get(User, annotation.resolved_by) if annotation.resolved_by else None
    return _read(annotation, author, resolver)


async def _annotation(db: AsyncSession, wireframe: Wireframe, annotation_id: UUID) -> WireframeAnnotation:
    result = await db.execute(
        select(WireframeAnnotation).where(
            WireframeAnnotation.id == annotation_id,
            WireframeAnnotation.wireframe_id == wireframe.id,
            WireframeAnnotation.account_id == wireframe.account_id,
        )
    )
    annotation = result.scalar_one_or_none()
    if annotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")
    return annotation


@router.get(
    "/projects/{project_id}/wireframes/{wireframe_id}/annotations", response_model=list[AnnotationRead]
)
async def list_annotations(
    project_id: UUID,
    wireframe_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[AnnotationRead]:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    author = aliased(User)
    resolver = aliased(User)
    # users carries no RLS, so the joins are safe from a scoped transaction.
    result = await db.execute(
        select(WireframeAnnotation, author, resolver)
        .outerjoin(author, author.id == WireframeAnnotation.created_by)
        .outerjoin(resolver, resolver.id == WireframeAnnotation.resolved_by)
        .where(
            WireframeAnnotation.wireframe_id == wireframe.id,
            WireframeAnnotation.account_id == ctx.scope_id,
        )
        .order_by(WireframeAnnotation.created_at.desc())
    )
    return [_read(annotation, author_row, resolver_row) for annotation, author_row, resolver_row in result.all()]


@router.post(
    "/projects/{project_id}/wireframes/{wireframe_id}/annotations",
    response_model=AnnotationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_annotation(
    project_id: UUID,
    wireframe_id: UUID,
    payload: AnnotationCreate,
    ctx: ScopeContext = Depends(require_any_permission(["data:write", "tasks:create"])),
    db: AsyncSession = Depends(get_db),
) -> AnnotationRead:
    # An organisation member reads the whole product but writes nothing except
    # tasks, so `tasks:create` opens this one route and only for kind="task".
    # Notes stay behind data:write, as do editing, deleting and resolving --
    # the other three routes in this module are unchanged.
    if payload.kind != "task" and not ctx.has_permission("data:write"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required permission: data:write",
        )
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    # Lock the wireframe row while minting the number so concurrent creates
    # serialise; the (wireframe_id, kind, seq) unique constraint is the
    # backstop. Same lock style as page ops (FOR NO KEY UPDATE).
    wireframe = (
        await db.execute(
            select(Wireframe).where(Wireframe.id == wireframe.id).with_for_update(key_share=True)
        )
    ).scalar_one()
    page = await get_wireframe_page(db, ctx, wireframe.id, payload.page_id)
    if not find_annotation_target(page.document, payload.target_kind, payload.target_id, payload.target_cmp_id):
        # The client creates from a live selection, so a miss means the target
        # was deleted underneath it -- fail loudly rather than store an orphan.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Annotation target no longer exists on this page",
        )
    if payload.kind == "task":
        wireframe.task_seq = (wireframe.task_seq or 0) + 1
        seq = wireframe.task_seq
    else:
        wireframe.note_seq = (wireframe.note_seq or 0) + 1
        seq = wireframe.note_seq
    annotation = WireframeAnnotation(
        project_id=project.id,
        wireframe_id=wireframe.id,
        account_id=project.account_id,
        page_id=page.id,
        kind=payload.kind,
        seq=seq,
        target_kind=payload.target_kind,
        target_id=payload.target_id,
        target_cmp_id=payload.target_cmp_id,
        target_label=payload.target_label,
        text=payload.text,
        created_by=ctx.user_id,
    )
    db.add(annotation)
    await record_event(
        db,
        project=project,
        wireframe=wireframe,
        user_id=ctx.user_id,
        event=f"{payload.kind}_created",
        page_id=page.id,
        detail={"seq": seq, "target_label": payload.target_label, "excerpt": payload.text[:120]},
    )
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(annotation)
    return await _read_one(db, annotation)


@router.patch(
    "/projects/{project_id}/wireframes/{wireframe_id}/annotations/{annotation_id}",
    response_model=AnnotationRead,
)
async def update_annotation(
    project_id: UUID,
    wireframe_id: UUID,
    annotation_id: UUID,
    payload: AnnotationUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> AnnotationRead:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    annotation = await _annotation(db, wireframe, annotation_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("text") is not None and updates["text"] != annotation.text:
        annotation.text = updates["text"]
        annotation.updated_by = ctx.user_id
        annotation.updated_at = utc_now()
        await record_event(
            db,
            project=project,
            wireframe=wireframe,
            user_id=ctx.user_id,
            event=f"{annotation.kind}_edited",
            page_id=annotation.page_id,
            detail={"seq": annotation.seq, "excerpt": annotation.text[:120]},
        )
    if updates.get("resolved") is not None:
        if annotation.kind != "task":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only tasks can be resolved"
            )
        if updates["resolved"] and annotation.resolved_at is None:
            annotation.resolved_at = utc_now()
            annotation.resolved_by = ctx.user_id
            await record_event(
                db,
                project=project,
                wireframe=wireframe,
                user_id=ctx.user_id,
                event="task_resolved",
                page_id=annotation.page_id,
                detail={"seq": annotation.seq},
            )
        elif not updates["resolved"] and annotation.resolved_at is not None:
            annotation.resolved_at = None
            annotation.resolved_by = None
            await record_event(
                db,
                project=project,
                wireframe=wireframe,
                user_id=ctx.user_id,
                event="task_reopened",
                page_id=annotation.page_id,
                detail={"seq": annotation.seq},
            )
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(annotation)
    return await _read_one(db, annotation)


@router.delete(
    "/projects/{project_id}/wireframes/{wireframe_id}/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_annotation(
    project_id: UUID,
    wireframe_id: UUID,
    annotation_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    annotation = await _annotation(db, wireframe, annotation_id)
    # Keep a generous excerpt so the audit trail stays meaningful after the
    # annotation itself is gone.
    await record_event(
        db,
        project=project,
        wireframe=wireframe,
        user_id=ctx.user_id,
        event=f"{annotation.kind}_deleted",
        page_id=annotation.page_id,
        detail={"seq": annotation.seq, "target_label": annotation.target_label, "text": annotation.text[:500]},
    )
    await db.delete(annotation)
    project.updated_at = utc_now()
    await db.commit()
