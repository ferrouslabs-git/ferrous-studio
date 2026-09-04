"""Document routes. Files never pass through the API: the browser uploads
straight to S3 with a presigned PUT and confirms afterwards, at which point
the object is checked (present, right size, right magic bytes) before the row
is marked ``uploaded``.

Per the OWASP file-upload guidance: allow-list by extension *and* MIME type,
verify the signature bytes rather than trusting the client, store under a
random key, and serve downloads as attachments.
"""
import re
import unicodedata
from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext
from app.config import get_settings

from . import storage
from .common import get_project, get_writable_project
from .models import Project, ProjectDocument, utc_now
from .schemas import DocumentCreate, DocumentDownload, DocumentRead, DocumentUploadTicket

router = APIRouter()

# extension -> (canonical MIME type, MIME types a browser may send instead)
ALLOWED_TYPES: dict[str, tuple[str, set[str]]] = {
    "txt": ("text/plain", {"text/plain", ""}),
    "md": ("text/markdown", {"text/markdown", "text/x-markdown", "text/plain", ""}),
    "pdf": ("application/pdf", {"application/pdf"}),
    "docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"},
    ),
    "png": ("image/png", {"image/png"}),
    "jpg": ("image/jpeg", {"image/jpeg"}),
    "jpeg": ("image/jpeg", {"image/jpeg"}),
}

# First bytes of each binary format; text types are not checked.
MAGIC_BYTES: dict[str, tuple[bytes, ...]] = {
    "application/pdf": (b"%PDF",),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b"PK\x03\x04",),
    "image/png": (b"\x89PNG",),
    "image/jpeg": (b"\xff\xd8\xff",),
}

PENDING_VISIBLE_FOR = timedelta(hours=1)

_UNSAFE = re.compile(r"[\\/:*?\"<>|\x00-\x1f\x7f]+")


def sanitise_filename(raw: str) -> str:
    """A display/S3-safe name: no path separators or control characters,
    normalised Unicode, bounded length, extension kept."""
    name = unicodedata.normalize("NFKC", raw).strip().strip(".")
    name = _UNSAFE.sub("_", name)
    name = re.sub(r"\s+", " ", name)
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid file name")
    if len(name) > 200:
        stem, _, ext = name.rpartition(".")
        name = (stem[: 200 - len(ext) - 1] + "." + ext) if ext else name[:200]
    return name


def resolve_type(filename: str, client_type: str) -> str:
    """The canonical content type for this upload, or 422."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    entry = ALLOWED_TYPES.get(ext)
    if entry is None:
        allowed = ", ".join(f".{e}" for e in ALLOWED_TYPES)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File type not allowed. Accepted: {allowed}",
        )
    canonical, aliases = entry
    declared = client_type.split(";")[0].strip().lower()
    if declared not in aliases:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Content type {client_type!r} does not match a .{ext} file",
        )
    return canonical


def s3_key_for(account_id: UUID, project_id: UUID, document_id: UUID, filename: str) -> str:
    return f"{account_id}/{project_id}/{document_id}/{filename}"


def _not_configured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Document storage is not configured (DOCUMENTS_BUCKET)",
    )


async def _document(db: AsyncSession, project: Project, document_id: UUID) -> ProjectDocument:
    result = await db.execute(
        select(ProjectDocument).where(
            ProjectDocument.id == document_id,
            ProjectDocument.project_id == project.id,
            ProjectDocument.account_id == project.account_id,
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


@router.get("/projects/{project_id}/documents", response_model=list[DocumentRead])
async def list_documents(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectDocument]:
    project = await get_project(db, project_id, ctx)
    result = await db.execute(
        select(ProjectDocument)
        .where(ProjectDocument.project_id == project.id, ProjectDocument.account_id == project.account_id)
        .order_by(ProjectDocument.created_at.desc())
    )
    cutoff = utc_now() - PENDING_VISIBLE_FOR
    # Uploads still in flight show for an hour; abandoned ones drop out of view.
    return [d for d in result.scalars() if d.status == "uploaded" or d.created_at >= cutoff]


@router.post(
    "/projects/{project_id}/documents", response_model=DocumentUploadTicket, status_code=status.HTTP_201_CREATED
)
async def create_document(
    project_id: UUID,
    payload: DocumentCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    if not settings.documents_bucket:
        raise _not_configured()
    project = await get_writable_project(db, project_id, ctx)

    filename = sanitise_filename(payload.filename)
    content_type = resolve_type(filename, payload.content_type)
    if payload.size_bytes > settings.documents_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File is larger than {settings.documents_max_bytes // (1024 * 1024)} MB",
        )

    doc_id = uuid4()
    doc = ProjectDocument(
        id=doc_id,
        project_id=project.id,
        account_id=project.account_id,
        filename=filename,
        content_type=content_type,
        size_bytes=payload.size_bytes,
        s3_key=s3_key_for(project.account_id, project.id, doc_id, filename),
        status="pending",
        uploaded_by=ctx.user_id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    url = storage.presign_put(doc.s3_key, content_type, payload.size_bytes, settings.presign_ttl_seconds)
    return DocumentUploadTicket(
        document=DocumentRead.model_validate(doc),
        upload_url=url,
        headers={"Content-Type": content_type},
        expires_in=settings.presign_ttl_seconds,
    )


@router.post("/projects/{project_id}/documents/{document_id}/confirm", response_model=DocumentRead)
async def confirm_document(
    project_id: UUID,
    document_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDocument:
    settings = get_settings()
    if not settings.documents_bucket:
        raise _not_configured()
    project = await get_writable_project(db, project_id, ctx)
    doc = await _document(db, project, document_id)
    if doc.status == "uploaded":
        return doc

    try:
        info = await storage.head_object(doc.s3_key)
    except storage.ObjectMissing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The upload has not completed") from None

    async def reject(reason: str) -> None:
        await storage.delete_object(doc.s3_key)
        await db.delete(doc)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=reason)

    if info.size != doc.size_bytes or info.size > settings.documents_max_bytes:
        await reject("Uploaded file size does not match")
    if info.content_type and info.content_type.split(";")[0].strip().lower() != doc.content_type:
        await reject("Uploaded file type does not match")

    signatures = MAGIC_BYTES.get(doc.content_type)
    if signatures:
        head = await storage.read_object(doc.s3_key, (0, 7))
        if not any(head.startswith(sig) for sig in signatures):
            await reject(f"The file does not look like a {doc.filename.rsplit('.', 1)[-1].upper()} file")

    doc.status = "uploaded"
    doc.confirmed_at = utc_now()
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/projects/{project_id}/documents/{document_id}/download", response_model=DocumentDownload)
async def download_document(
    project_id: UUID,
    document_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    if not settings.documents_bucket:
        raise _not_configured()
    project = await get_project(db, project_id, ctx)
    doc = await _document(db, project, document_id)
    if doc.status != "uploaded":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The upload has not completed")
    return DocumentDownload(
        url=storage.presign_get(doc.s3_key, doc.filename, settings.presign_ttl_seconds),
        expires_in=settings.presign_ttl_seconds,
    )


@router.delete("/projects/{project_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    project_id: UUID,
    document_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_writable_project(db, project_id, ctx)
    doc = await _document(db, project, document_id)
    if get_settings().documents_bucket:
        await storage.delete_object(doc.s3_key)
    await db.delete(doc)
    project.updated_at = utc_now()
    await db.commit()
