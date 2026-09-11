"""The bundle importer's pure pieces.

``import_bundle`` itself needs a database (matching every existing project
row, creating the rest) and this suite has none -- ``resolve_by_name`` and
``insert_pages``'s reuse are what can be tested without one; the route's own
behaviour (locking, permission, one-transaction rollback) is exercised live
via ``run-local``, not here.
"""
import inspect

from app.studio.importing import _import_wireframe, create_bundle_content, import_bundle, resolve_by_name
from app.studio.wireframes import copy_version_to_wireframe, insert_pages


def test_resolve_by_name_matches_case_insensitively():
    existing = {"administrator": object()}
    assert resolve_by_name("Administrator", existing) is existing["administrator"]
    assert resolve_by_name("ADMINISTRATOR", existing) is existing["administrator"]


def test_resolve_by_name_returns_none_for_a_new_name():
    assert resolve_by_name("Nobody", {"administrator": object()}) is None


def test_resolve_by_name_does_not_strip_or_otherwise_normalise():
    """Only case-folding -- a name that differs by whitespace is a genuinely
    different name, not a typo to paper over."""
    existing = {"administrator": object()}
    assert resolve_by_name(" Administrator", existing) is None


def test_import_bundle_reuses_insert_pages_not_a_third_copy_of_the_loop():
    source = inspect.getsource(_import_wireframe) + inspect.getsource(copy_version_to_wireframe)
    assert source.count("insert_pages(") >= 2, (
        "both the version-copy route and the bundle importer should call the shared "
        "insert_pages helper rather than each looping over pages themselves"
    )


def test_import_bundle_is_lock_exempt_like_restore():
    """Import is content, exactly like restore -- resolved through
    get_writable_project, which is what makes tests/test_lock_coverage.py's
    generic sweep reject it on a locked version without needing an
    exemption here."""
    assert "get_writable_project" in inspect.getsource(import_bundle)


def test_import_bundle_validates_before_writing_anything():
    """The route delegates to create_bundle_content, which is where the
    actual validate-then-write ordering lives now."""
    assert "create_bundle_content(" in inspect.getsource(import_bundle)
    source = inspect.getsource(create_bundle_content)
    assert source.index("validate_bundle(") < source.index("_resolve_actors(")


def test_import_bundle_commits_only_after_create_bundle_content_succeeds():
    """create_bundle_content itself never commits (so the chatbot's tool can
    share one transaction with the rest of the conversation) -- only the
    route commits, and only once errors have been checked."""
    source = inspect.getsource(import_bundle)
    assert "await db.commit()" not in inspect.getsource(create_bundle_content)
    assert source.index("if errors:") < source.index("await db.commit()")


def test_remap_dataset_ids_is_called_for_its_mutation_not_its_return_value():
    """remap_dataset_ids mutates its ``pages`` argument in place and returns
    None (see its docstring in ops.py) -- assigning its result, as in
    ``pages_data = remap_dataset_ids(...)``, silently sets pages_data to None
    and breaks every import. This shipped to staging once; guard against it
    coming back."""
    source = inspect.getsource(_import_wireframe)
    assert "= remap_dataset_ids(" not in source
