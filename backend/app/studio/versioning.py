"""Versioning a whole project: deep-copy it, then let the copy diverge.

A version is not a side table -- it is another ``projects`` row. Every child
table is keyed by ``project_id`` and policed by RLS on ``account_id``, so a
copy needs no new query, no new policy and no new route anywhere else; the
projects list and the version switcher group rows by ``lineage_id``.

The whole job is therefore reference rewriting. Ids are identity in the
database, so every row gets a fresh one and everything pointing at an old id
has to follow: use cases name actors, a wireframe names its landing page, a
child page names its parent page and a region of it, element links name pages,
element data names a dataset. Anything the copy does not carry across is
dropped rather than kept, because a surviving old id would silently reach back
into the source version.

Two things are deliberately not copied. History belongs to the version that
made it, so wireframe snapshots and the audit trail stay behind and the new
version gets a single "created from" entry instead; and op-batch idempotency
rows describe requests that already happened.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import storage
from .audit import record_event
from .documents import s3_key_for
from .designs import revision_keys
from .models import (
    Dataset,
    DesignRevision,
    Persona,
    Project,
    ProjectDesign,
    ProjectDiagram,
    ProjectDocument,
    ProjectPage,
    UseCase,
    UseCaseActor,
    Wireframe,
    WireframeActor,
    WireframeAnnotation,
    WireframePersona,
    utc_now,
)
from .ops import export_page, import_page, remap_dataset_ids, remap_page_ids
from .wireframes import state_of

#: Everything a version carries across. Checked against the schema by
#: ``tests/test_version_coverage.py``, so a new project-owned table cannot be
#: added without deciding which side of this line it falls on.
COPIED_TABLES = frozenset(
    {
        "personas",
        "datasets",
        "use_case_actors",
        "use_cases",
        "wireframes",
        "wireframe_personas",
        "wireframe_actors",
        "project_pages",
        "wireframe_annotations",
        "project_diagrams",
        "project_documents",
        "project_designs",
        "design_revisions",
    }
)

#: History and request bookkeeping, which belong to the version that made them.
#: project_agent_messages joins this group rather than COPIED_TABLES for the
#: same reason as wireframe_audit_log: a conversation is a record of what was
#: said about *this* version, not content to carry forward -- a new version
#: starts its Project Agent tab with a clean history.
#:
#: board_tokens is here for a different reason: the actual access grant a
#: token carries is board_id, which already survives versioning on its own
#: (one board per lineage_id, shared by every version -- see
#: board/service.py's get_or_create_board) without board_tokens needing to
#: be copied at all. Its project_id column (the "whoami" lookup,
#: board/agent_routes.py) is only a record of the exact project row someone
#: was looking at when they minted it -- copying that forward would just
#: point a new version's whoami answer at the wrong (old) version.
SKIPPED_TABLES = frozenset(
    {"project_versions", "wireframe_audit_log", "project_op_batches", "project_agent_messages", "board_tokens"}
)


async def _rows(db: AsyncSession, model: Any, project: Project, order: Any = None) -> list[Any]:
    stmt = select(model).where(model.project_id == project.id, model.account_id == project.account_id)
    if order is not None:
        stmt = stmt.order_by(order)
    return list((await db.execute(stmt)).scalars().all())


def _mapped(value: Any, mapping: dict[UUID, UUID]) -> UUID | None:
    """``value`` translated through ``mapping``, or None if it did not travel."""
    try:
        return mapping.get(UUID(str(value)))
    except (AttributeError, TypeError, ValueError):
        return None


async def next_version_no(db: AsyncSession, project: Project) -> int:
    """One past the highest version number in this lineage.

    Numbering is per lineage rather than per branch, so every version reads as a
    distinct v-number even though versions form a tree: two siblings branched
    from v1 are v2 and v3, not two v2s.
    """
    highest = (
        await db.execute(
            select(func.max(Project.version_no)).where(
                Project.lineage_id == project.lineage_id,
                Project.account_id == project.account_id,
            )
        )
    ).scalar_one_or_none()
    return int(highest or 0) + 1


async def version_for_key(db: AsyncSession, source: Project, key: str) -> Project | None:
    """The version this idempotency key already created, if this is a replay."""
    return (
        await db.execute(
            select(Project).where(
                Project.parent_project_id == source.id,
                Project.version_key == key,
                Project.account_id == source.account_id,
            )
        )
    ).scalar_one_or_none()


async def copy_project(
    db: AsyncSession,
    source: Project,
    *,
    user_id: UUID | None,
    key: str,
    label: str | None,
    lock_source: bool,
) -> tuple[Project, "PendingCopies"]:
    """Deep-copy ``source`` into a new version. Flushes, but does not commit.

    Returns the new project and the S3 copies its documents and design
    revisions still need. Those run after the caller commits
    (``finish_copies``): they are blocking network calls, and holding a write
    transaction open across them would be a long-lived lock for no benefit.
    """
    account_id = source.account_id
    copy = Project(
        id=uuid4(),
        account_id=account_id,
        created_by=user_id,
        name=source.name,
        description=source.description,
        rationale=source.rationale,
        physical_setup=source.physical_setup,
        hosting=source.hosting,
        latency_goal=source.latency_goal,
        accuracy_goal=source.accuracy_goal,
        status=source.status,
        custom_components=source.custom_components or [],
        schema_version=source.schema_version,
        version=0,
        lineage_id=source.lineage_id,
        parent_project_id=source.id,
        version_no=await next_version_no(db, source),
        version_label=label,
        version_key=key,
        # The repository link travels with the copy: a new version of a project
        # is still being built into the same repository, and re-picking it every
        # time would be busywork. Only the ids matter -- the installation is the
        # organisation's, and both versions read through the same one.
        repo_id=source.repo_id,
        repo_full_name=source.repo_full_name,
        repo_linked_at=source.repo_linked_at,
        repo_linked_by=source.repo_linked_by,
    )
    db.add(copy)

    def child(model: Any, /, **fields: Any) -> Any:
        """A row of ``model`` under the new project, with a fresh id.

        Positional-only: ``ProjectDiagram`` has a column called ``model``, and a
        named parameter would collide with it.
        """
        return model(id=uuid4(), project_id=copy.id, account_id=account_id, **fields)

    # ── Personas, user types, datasets, diagrams ──
    persona_map: dict[UUID, UUID] = {}
    for row in await _rows(db, Persona, source, Persona.pos.asc()):
        new = child(
            Persona,
            name=row.name,
            role=row.role,
            primary_interface=row.primary_interface,
            traits=row.traits,
            jobs_to_be_done=row.jobs_to_be_done,
            pain_points=row.pain_points,
            feelings=row.feelings,
            notes=row.notes,
            pos=row.pos,
            created_by=row.created_by,
        )
        persona_map[row.id] = new.id
        db.add(new)

    actor_map: dict[UUID, UUID] = {}
    for row in await _rows(db, UseCaseActor, source, UseCaseActor.pos.asc()):
        new = child(UseCaseActor, name=row.name, description=row.description, kind=row.kind, pos=row.pos, created_by=row.created_by)
        actor_map[row.id] = new.id
        db.add(new)

    dataset_map: dict[str, str] = {}
    for row in await _rows(db, Dataset, source, Dataset.pos.asc()):
        new = child(Dataset, name=row.name, kind=row.kind, values=row.values, match_terms=row.match_terms, pos=row.pos, created_by=row.created_by)
        dataset_map[str(row.id)] = str(new.id)
        db.add(new)

    for row in await _rows(db, ProjectDiagram, source, ProjectDiagram.created_at.asc()):
        # xml/model hold maxGraph cell ids only -- nothing pointing outside the
        # diagram -- so they travel verbatim.
        db.add(
            child(
                ProjectDiagram,
                name=row.name,
                kind=row.kind,
                xml=row.xml,
                model=row.model,
                version=0,
                created_by=row.created_by,
            )
        )

    # ── Use cases, which name their actors ──
    for row in await _rows(db, UseCase, source, UseCase.pos.asc()):
        travelled = [_mapped(actor_id, actor_map) for actor_id in row.actor_ids or []]
        db.add(
            child(
                UseCase,
                name=row.name,
                description=row.description,
                actor_ids=[str(actor_id) for actor_id in travelled if actor_id is not None],
                pos=row.pos,
                created_by=row.created_by,
            )
        )

    # ── Wireframes ──
    pairs: list[tuple[Wireframe, Wireframe]] = []
    wireframe_map: dict[UUID, UUID] = {}
    for row in await _rows(db, Wireframe, source, Wireframe.pos.asc()):
        new = child(
            Wireframe,
            name=row.name,
            interface_type=row.interface_type,
            status=row.status,
            pos=row.pos,
            note_seq=row.note_seq,
            task_seq=row.task_seq,
            created_by=row.created_by,
        )
        wireframe_map[row.id] = new.id
        pairs.append((row, new))
        db.add(new)

    await _copy_joins(db, source, copy, wireframe_map, persona_map, actor_map)
    page_map = await _copy_pages(db, source, copy, wireframe_map, dataset_map, pairs)
    await _copy_annotations(db, source, copy, wireframe_map, page_map)
    document_copies, document_map = await _copy_documents(db, source, copy)
    revision_copies = await _copy_designs(db, source, copy, wireframe_map, document_map)
    pending_copies = PendingCopies(documents=document_copies, revisions=revision_copies)

    if lock_source:
        source.locked_at = utc_now()
        source.locked_by = user_id

    await record_event(
        db,
        project=copy,
        wireframe=None,
        user_id=user_id,
        event="version_created",
        detail={
            "from_project_id": str(source.id),
            "from_version_no": source.version_no,
            "version_no": copy.version_no,
            "label": label,
        },
    )
    await db.flush()
    return copy, pending_copies


async def _copy_joins(
    db: AsyncSession,
    source: Project,
    copy: Project,
    wireframe_map: dict[UUID, UUID],
    persona_map: dict[UUID, UUID],
    actor_map: dict[UUID, UUID],
) -> None:
    """The wireframe-to-persona and wireframe-to-user-type links.

    These two tables carry no ``project_id``, so they are reached through the
    wireframes that own them rather than through the project.
    """
    if not wireframe_map:
        return
    old_ids = list(wireframe_map)
    for model, target, mapping in (
        (WireframePersona, "persona_id", persona_map),
        (WireframeActor, "actor_id", actor_map),
    ):
        links = (
            await db.execute(
                select(model).where(model.wireframe_id.in_(old_ids), model.account_id == source.account_id)
            )
        ).scalars()
        for link in links:
            travelled = mapping.get(getattr(link, target))
            if travelled is None:
                continue
            db.add(
                model(
                    wireframe_id=wireframe_map[link.wireframe_id],
                    account_id=copy.account_id,
                    **{target: travelled},
                )
            )


async def _copy_pages(
    db: AsyncSession,
    source: Project,
    copy: Project,
    wireframe_map: dict[UUID, UUID],
    dataset_map: dict[str, str],
    pairs: list[tuple[Wireframe, Wireframe]],
) -> dict[str, str]:
    """Every page of the project, remapped in one pass.

    One pass over the whole project rather than one per wireframe, so a link
    that crosses from one wireframe into another survives instead of being
    dropped as a foreign target.

    The export shape carries neither ``wireframe_id`` nor ``pos``, so both come
    from the source row -- and ``pos`` travels verbatim: minting a single fresh
    sequence across every page of the project would silently reorder each
    wireframe's pages. Ordering keys only ever compete within one wireframe, so
    identical keys in two projects never interact.
    """
    pages = await _rows(db, ProjectPage, source, ProjectPage.pos.asc())
    page_map = {str(page.id): str(uuid4()) for page in pages}
    origin_of = {page_map[str(page.id)]: page for page in pages}

    remapped = remap_page_ids([export_page(str(page.id), state_of(page)) for page in pages], page_map)
    remap_dataset_ids(remapped, dataset_map)

    for data in remapped:
        origin = origin_of[data["id"]]
        imported = import_page(data)
        db.add(
            ProjectPage(
                id=UUID(data["id"]),
                project_id=copy.id,
                wireframe_id=wireframe_map[origin.wireframe_id],
                account_id=copy.account_id,
                name=imported["name"],
                route=imported["route"],
                pos=origin.pos,
                placement=imported["placement"],
                presentation=imported["presentation"],
                document=imported["document"],
                # A fresh copy has no edit history for anyone to conflict against.
                entity_versions={},
                version=0,
            )
        )

    for old_wireframe, new_wireframe in pairs:
        if old_wireframe.landing_page_id is None:
            continue
        landed = page_map.get(str(old_wireframe.landing_page_id))
        # A landing page that did not travel is left unset, which is the same
        # fallback a dangling id already has: open the first nav-linked page.
        new_wireframe.landing_page_id = UUID(landed) if landed else None
    return page_map


async def _copy_annotations(
    db: AsyncSession,
    source: Project,
    copy: Project,
    wireframe_map: dict[UUID, UUID],
    page_map: dict[str, str],
) -> None:
    """Notes and tasks, keeping their numbers.

    ``seq`` travels verbatim: it is unique per wireframe per kind, the wireframe
    id is new, and the counters that mint it came across on the wireframe row --
    so N-3 stays N-3 and the next note is still N-4. ``target_id`` and
    ``target_cmp_id`` are document-local uids that the page round trip leaves
    untouched, so they still resolve.

    An annotation whose page did not travel is dropped: ``page_id`` has no
    foreign key, so keeping it would write a reference to the source version's
    page that nothing could ever resolve or clean up.
    """
    for row in await _rows(db, WireframeAnnotation, source, WireframeAnnotation.created_at.asc()):
        new_page_id = page_map.get(str(row.page_id))
        if new_page_id is None or row.wireframe_id not in wireframe_map:
            continue
        db.add(
            WireframeAnnotation(
                id=uuid4(),
                project_id=copy.id,
                wireframe_id=wireframe_map[row.wireframe_id],
                account_id=copy.account_id,
                page_id=UUID(new_page_id),
                kind=row.kind,
                seq=row.seq,
                target_kind=row.target_kind,
                target_id=row.target_id,
                target_cmp_id=row.target_cmp_id,
                target_label=row.target_label,
                text=row.text,
                resolved_at=row.resolved_at,
                resolved_by=row.resolved_by,
                created_by=row.created_by,
                updated_by=row.updated_by,
            )
        )


@dataclass(frozen=True)
class RevisionCopy:
    """The objects one copied design revision still needs: its new id, and
    ``(source_key, destination_key)`` for the HTML and, if it has one, the
    source archive."""

    revision_id: UUID
    html: tuple[str, str]
    source: tuple[str, str] | None


@dataclass(frozen=True)
class PendingCopies:
    """The S3 work a new version is still owed once its rows are committed."""

    documents: list[tuple[str, str]]
    revisions: list[RevisionCopy]


async def _copy_documents(
    db: AsyncSession, source: Project, copy: Project
) -> tuple[list[tuple[str, str]], dict[UUID, UUID]]:
    """Rows for the copied documents, plus the S3 work they still need and
    the old-to-new id map (a design's brief names its reference images).

    Rows land as ``pending`` -- the same state a browser upload sits in before
    its object is confirmed -- and are flipped to ``uploaded`` once the bytes
    are there. An interrupted copy therefore leaves recoverable rows that the
    listing already hides after an hour, rather than rows that would presign a
    download of an object nobody ever wrote.
    """
    work: list[tuple[str, str]] = []
    document_map: dict[UUID, UUID] = {}
    for row in await _rows(db, ProjectDocument, source, ProjectDocument.created_at.asc()):
        if row.status != "uploaded":
            continue  # an upload that never completed has nothing to copy
        new_id = uuid4()
        document_map[row.id] = new_id
        new_key = s3_key_for(copy.account_id, copy.id, new_id, row.filename)
        db.add(
            ProjectDocument(
                id=new_id,
                project_id=copy.id,
                account_id=copy.account_id,
                filename=row.filename,
                content_type=row.content_type,
                size_bytes=row.size_bytes,
                s3_key=new_key,
                status="pending",
                purpose=row.purpose,
                uploaded_by=row.uploaded_by,
            )
        )
        work.append((row.s3_key, new_key))
    return work, document_map


async def _copy_designs(
    db: AsyncSession,
    source: Project,
    copy: Project,
    wireframe_map: dict[UUID, UUID],
    document_map: dict[UUID, UUID],
) -> list[RevisionCopy]:
    """High-fidelity designs and their revisions, plus the S3 work the
    revisions still need.

    Revisions land as ``pending`` for the reason documents do: a row must
    never offer an object nobody has written yet. ``current_revision_id`` is
    remapped straight away and corrected by ``finish_design_copies`` if that
    object does not arrive.

    ``figma_url`` travels: the new version mirrors the same Make file. The
    source is normally locked by versioning, and a locked project refuses
    every design write, so syncs land on one version, not both.

    A design whose wireframe did not travel is dropped, like an annotation
    whose page did not: ``wireframe_id`` has no foreign key, so keeping it
    would point the copy back into the source version.
    """
    design_map: dict[UUID, UUID] = {}
    copies: dict[UUID, ProjectDesign] = {}
    current_of: dict[UUID, UUID | None] = {}
    for row in await _rows(db, ProjectDesign, source, ProjectDesign.pos.asc()):
        new_wireframe = wireframe_map.get(row.wireframe_id)
        if new_wireframe is None:
            continue
        references = [_mapped(doc_id, document_map) for doc_id in row.reference_document_ids or []]
        new = ProjectDesign(
            id=uuid4(),
            project_id=copy.id,
            account_id=copy.account_id,
            wireframe_id=new_wireframe,
            name=row.name,
            brief=row.brief,
            reference_document_ids=[str(doc_id) for doc_id in references if doc_id is not None],
            figma_url=row.figma_url,
            published_url=row.published_url,
            current_revision_id=None,
            status=row.status,
            pos=row.pos,
            synced_at=row.synced_at,
            created_by=row.created_by,
        )
        design_map[row.id] = new.id
        copies[row.id] = new
        current_of[row.id] = row.current_revision_id
        db.add(new)

    # Parents before children: the session orders inserts between tables by
    # mapped relationships, and these models declare none.
    await db.flush()

    work: list[RevisionCopy] = []
    for row in await _rows(db, DesignRevision, source, DesignRevision.revision_no.asc()):
        new_design = design_map.get(row.design_id)
        if new_design is None or row.status != "uploaded":
            continue
        new_id = uuid4()
        html_key, source_key = revision_keys(copy.account_id, copy.id, new_design, new_id)
        db.add(
            DesignRevision(
                id=new_id,
                design_id=new_design,
                project_id=copy.id,
                account_id=copy.account_id,
                revision_no=row.revision_no,
                html_key=html_key,
                source_key=source_key if row.source_key else None,
                html_bytes=row.html_bytes,
                source_bytes=row.source_bytes,
                source_hash=row.source_hash,
                origin=row.origin,
                summary=row.summary,
                status="pending",
                created_at=row.created_at,
            )
        )
        if current_of[row.design_id] == row.id:
            copies[row.design_id].current_revision_id = new_id
        work.append(
            RevisionCopy(
                revision_id=new_id,
                html=(row.html_key, html_key),
                source=(row.source_key, source_key) if row.source_key else None,
            )
        )
    return work


async def finish_copies(db: AsyncSession, copy: Project, pending: PendingCopies) -> None:
    """Everything a new version is owed from S3, after its rows are committed."""
    await finish_document_copies(db, copy, pending.documents)
    await finish_design_copies(db, copy, pending.revisions)


async def finish_design_copies(db: AsyncSession, copy: Project, work: list[RevisionCopy]) -> int:
    """Copy each revision's objects, then mark those that arrived as uploaded.

    A revision counts as arrived once its HTML is there -- that is what the
    page shows; a missing source archive costs the copy its ``source_key``,
    not the revision. A design whose current revision did not arrive is
    pointed at its newest one that did, or at none.
    """
    if not work:
        return 0
    arrived: dict[UUID, bool] = {}  # revision id -> whether its source archive came too
    for item in work:
        try:
            await storage.copy_object(*item.html)
        except storage.ObjectMissing:
            continue
        except storage.StorageNotConfigured:
            break
        has_source = False
        if item.source is not None:
            try:
                await storage.copy_object(*item.source)
                has_source = True
            except storage.ObjectMissing:
                pass
        arrived[item.revision_id] = has_source

    revisions = list(
        (
            await db.execute(
                select(DesignRevision)
                .where(DesignRevision.project_id == copy.id, DesignRevision.account_id == copy.account_id)
                .order_by(DesignRevision.revision_no.asc())
            )
        ).scalars()
    )
    newest: dict[UUID, UUID] = {}
    for revision in revisions:
        if revision.id in arrived:
            revision.status = "uploaded"
            if not arrived[revision.id]:
                revision.source_key = None
                revision.source_bytes = None
        if revision.status == "uploaded":
            newest[revision.design_id] = revision.id
    uploaded = {revision.id for revision in revisions if revision.status == "uploaded"}
    designs = (
        await db.execute(
            select(ProjectDesign).where(ProjectDesign.project_id == copy.id, ProjectDesign.account_id == copy.account_id)
        )
    ).scalars()
    for design in designs:
        if design.current_revision_id not in uploaded:
            design.current_revision_id = newest.get(design.id)
    await db.commit()
    return len(arrived)


async def finish_document_copies(db: AsyncSession, copy: Project, work: list[tuple[str, str]]) -> int:
    """Copy the bytes, then mark the rows whose objects arrived as uploaded.

    A source object that has gone missing is skipped rather than failing the
    whole version: that row stays ``pending`` and drops out of the listing,
    which is a far better outcome than losing the copy of everything else.
    """
    if not work:
        return 0
    copied: list[str] = []
    for source_key, dest_key in work:
        try:
            await storage.copy_object(source_key, dest_key)
        except storage.ObjectMissing:
            continue
        except storage.StorageNotConfigured:
            # No bucket configured at all: the rows stay pending and the
            # documents section already reports itself as unconfigured.
            return 0
        copied.append(dest_key)
    if not copied:
        return 0
    now = utc_now()
    documents = (
        await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.project_id == copy.id,
                ProjectDocument.account_id == copy.account_id,
                ProjectDocument.s3_key.in_(copied),
            )
        )
    ).scalars()
    for document in documents:
        document.status = "uploaded"
        document.confirmed_at = now
    await db.commit()
    return len(copied)
