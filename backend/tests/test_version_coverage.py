"""Every project-owned table must be either copied by a version or skipped.

There is no authoritative list of what hangs off a project anywhere else in the
codebase -- the ``STUDIO_TABLES`` tuple in migration b7e2c4d9a1f3 has been stale
for several releases. So a new table is easy to add and easy to forget, and
forgetting it means versions silently lose data with nothing failing.

This compares ``versioning``'s two lists against the schema itself, so adding a
project-owned table breaks here until someone decides which side of the line it
falls on.
"""
from app.database import Base
from app.studio import models  # noqa: F401  -- registers the tables on Base
from app.studio.versioning import COPIED_TABLES, SKIPPED_TABLES

#: Reached through the wireframes that own them rather than through the
#: project, so they carry no project_id of their own.
JOIN_TABLES = {"wireframe_personas", "wireframe_actors"}


def project_owned() -> set[str]:
    return {name for name, table in Base.metadata.tables.items() if "project_id" in table.c}


def test_every_project_owned_table_is_accounted_for():
    accounted = (COPIED_TABLES | SKIPPED_TABLES) - JOIN_TABLES
    missing = project_owned() - accounted
    assert not missing, (
        f"{sorted(missing)} hang off a project but versioning neither copies nor skips them. "
        f"Add each to COPIED_TABLES (and copy its rows) or to SKIPPED_TABLES."
    )


def test_no_stale_entries():
    known = project_owned() | JOIN_TABLES
    stale = (COPIED_TABLES | SKIPPED_TABLES) - known
    assert not stale, f"{sorted(stale)} are listed by versioning but no longer belong to a project"


def test_the_two_lists_do_not_overlap():
    assert not (COPIED_TABLES & SKIPPED_TABLES)


def test_join_tables_are_copied_not_skipped():
    """They hold the wireframe's personas and user types -- losing them would
    silently strip a copied wireframe of who it is for."""
    assert JOIN_TABLES <= COPIED_TABLES
