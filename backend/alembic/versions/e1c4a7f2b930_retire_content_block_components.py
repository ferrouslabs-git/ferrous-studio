"""retire the hero, detail, empty, main, modal and footer components

These six left the studio's vocabulary: they have no catalogue entry, no
renderer and no migration path, so any instance still stored would render as
a stray placeholder. This clears them out of both places a component can be
persisted:

  * ``project_pages.document`` -- the live page, components in the flat
    ``regions`` map keyed by region id;
  * ``project_versions.snapshot`` -- a saved snapshot, in the export shape
    where each region node of ``layout`` embeds its own ``components``.

``rightpanel-detail`` is included: it is the pre-restructure id that folded
into ``detail``, and untouched legacy documents may still carry it.

``project_pages.version`` is deliberately NOT bumped. The client strips the
same types on read (normalizePage, see RETIRED_TYPES in catalog.ts), so both
sides already agree on the document without one; bumping would only
manufacture conflicts for batches in flight. Stale ``entity_versions`` rows
for the removed component ids go with them.

Row-level security is enabled AND forced on the studio tables, so this sets
``app.is_super_admin`` first -- without it the SELECTs below return nothing
and the migration "succeeds" having changed not a single row (see
``7c41e2a9d0b3``).

Irreversible: the removed components are not recorded anywhere, so the
downgrade is a no-op rather than a lie.

Revision ID: e1c4a7f2b930
Revises: a2f7c9e4b618
Create Date: 2026-09-03
"""
import json
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1c4a7f2b930'
down_revision: Union[str, None] = 'a2f7c9e4b618'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RETIRED = {"hero", "detail", "empty", "main", "modal", "footer", "rightpanel-detail"}


def _split(components: Any) -> tuple[list[Any], list[str]] | None:
    """``(survivors, removed ids)`` for one component list, or None when
    nothing in it is retired (so the caller can leave the row alone)."""
    if not isinstance(components, list):
        return None
    kept = [c for c in components if not (isinstance(c, dict) and c.get("type") in RETIRED)]
    if len(kept) == len(components):
        return None
    removed = [
        str(c.get("id"))
        for c in components
        if isinstance(c, dict) and c.get("type") in RETIRED and c.get("id") is not None
    ]
    return kept, removed


def _clean_document(document: Any) -> list[str] | None:
    """Strip retired components from a stored page document, in place.
    Returns the removed component ids, or None if nothing changed."""
    if not isinstance(document, dict):
        return None
    regions = document.get("regions")
    if not isinstance(regions, dict):
        return None
    removed: list[str] = []
    for region_id, components in regions.items():
        result = _split(components)
        if result is None:
            continue
        regions[region_id], gone = result
        removed.extend(gone)
    return removed or None


def _clean_layout(node: Any) -> bool:
    """Strip retired components from an exported layout tree, in place."""
    if not isinstance(node, dict):
        return False
    changed = False
    result = _split(node.get("components"))
    if result is not None:
        node["components"], _ = result
        changed = True
    for child in node.get("children") or []:
        changed = _clean_layout(child) or changed
    return changed


def _clean_snapshot(snapshot: Any) -> bool:
    """Strip retired components from every page of an export envelope."""
    if not isinstance(snapshot, dict):
        return False
    pages = snapshot.get("pages")
    if not isinstance(pages, list):
        return False
    changed = False
    for page in pages:
        if isinstance(page, dict):
            changed = _clean_layout(page.get("layout")) or changed
    return changed


def upgrade() -> None:
    conn = op.get_bind()
    # Without this the forced RLS policies match no rows and nothing is cleaned.
    conn.execute(sa.text("SELECT set_config('app.is_super_admin', 'true', true)"))

    pages = conn.execute(sa.text("SELECT id, document, entity_versions FROM project_pages")).fetchall()
    for page_id, document, entity_versions in pages:
        removed = _clean_document(document)
        if removed is None:
            continue
        versions = dict(entity_versions) if isinstance(entity_versions, dict) else {}
        for component_id in removed:
            versions.pop(component_id, None)
        conn.execute(
            sa.text(
                "UPDATE project_pages"
                " SET document = CAST(:document AS jsonb),"
                "     entity_versions = CAST(:entity_versions AS jsonb)"
                " WHERE id = :id"
            ),
            {"document": json.dumps(document), "entity_versions": json.dumps(versions), "id": page_id},
        )

    versions_rows = conn.execute(sa.text("SELECT id, snapshot FROM project_versions")).fetchall()
    for version_id, snapshot in versions_rows:
        if not _clean_snapshot(snapshot):
            continue
        conn.execute(
            sa.text("UPDATE project_versions SET snapshot = CAST(:snapshot AS jsonb) WHERE id = :id"),
            {"snapshot": json.dumps(snapshot), "id": version_id},
        )


def downgrade() -> None:
    # The removed components were not copied anywhere first, so there is
    # nothing to put back. The schema is unchanged either way.
    pass
