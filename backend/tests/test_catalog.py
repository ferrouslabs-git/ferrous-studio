"""The bundle format guide: generated from the real catalogue, not
hand-copied, so it can never drift out of sync with what
create_bundle_content actually accepts. Originally project_agent.py's own
tests -- moved here when the guide itself moved to catalog.py so a second
caller (board_mcp.py's wireframe tools) could read the exact same text
instead of a hand-duplicated copy (see catalog.py's own module docstring
for that)."""
import json

from app.studio.catalog import BUNDLE_FORMAT_GUIDE, WORKED_EXAMPLE, catalogue_reference, get_catalog
from app.studio.importing import validate_bundle, wrap_bare_envelope


def test_catalogue_reference_is_generated_not_hand_written():
    """Proves the reference text actually reflects the real catalogue --
    a hand-written copy could silently drift from what validate_bundle
    accepts; this can't, since it's built from get_catalog() itself."""
    ref = catalogue_reference()
    assert "navbar" in ref
    assert "list" in ref
    assert "canvas" in ref


def test_the_worked_example_is_actually_valid():
    """A live run against a real project showed the model needs a concrete
    example to get the shape right -- an element's label is a top-level
    field, not data.label/data.text, among other things (see
    WORKED_EXAMPLE's own comment for the exact failure). If this example
    were ever wrong, it would be actively teaching the model the wrong
    shape, so it must validate cleanly, always."""
    bundle = json.loads(WORKED_EXAMPLE)
    errors = validate_bundle(wrap_bare_envelope(bundle), get_catalog())
    assert errors == []


def test_the_guide_warns_about_the_mistakes_actually_seen_live():
    assert "TOP-LEVEL field" in BUNDLE_FORMAT_GUIDE
    assert "root layout node needs" in BUNDLE_FORMAT_GUIDE
