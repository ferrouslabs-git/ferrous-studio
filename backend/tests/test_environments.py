"""The environment list: slugs are minted once and stay put, and what a
client may send is checked before any route sees it."""
import pytest
from pydantic import ValidationError

from app.studio.board.routes import _slug_for
from app.studio.board.schemas import EnvironmentCreate, EnvironmentOrder, EnvironmentWrite


def test_a_slug_is_the_label_lower_cased_and_hyphenated():
    assert _slug_for("Partner Sandbox", set()) == "partner-sand"
    assert _slug_for("EU  West (2)", set()) == "eu-west-2"


def test_a_taken_slug_gets_a_numeric_suffix_and_still_fits():
    taken = {"staging", "staging-2"}
    assert _slug_for("Staging", taken) == "staging-3"
    slug = _slug_for("Partner Sandbox", {"partner-sand"})
    assert slug == "partner-sand-2" and len(slug) <= 16


def test_a_label_with_nothing_sluggable_still_gets_a_slug():
    assert _slug_for("🚀", set()) == "env"
    assert _slug_for("🚀", {"env"}) == "env-2"


def test_the_reorder_route_name_is_never_minted():
    assert _slug_for("Order", {"order"}) == "order-2"


def test_an_environment_needs_a_name_and_an_http_address():
    with pytest.raises(ValidationError):
        EnvironmentCreate(label="   ")
    with pytest.raises(ValidationError):
        EnvironmentCreate(label="Demo", url="ftp://demo.example.com")
    made = EnvironmentCreate(label="  Demo ", url=" https://demo.example.com ")
    assert (made.label, made.url) == ("Demo", "https://demo.example.com")
    assert EnvironmentCreate(label="Demo").url == ""


def test_an_edit_leaves_out_what_it_does_not_change():
    edit = EnvironmentWrite(url="")
    assert edit.label is None and edit.url == ""
    assert EnvironmentWrite(label="QA").model_dump(exclude_unset=True) == {"label": "QA"}
    with pytest.raises(ValidationError):
        EnvironmentWrite(label="")


def test_an_order_is_a_list_of_well_formed_slugs():
    assert EnvironmentOrder(slugs=["uat", "eu-west-2"]).slugs == ["uat", "eu-west-2"]
    with pytest.raises(ValidationError):
        EnvironmentOrder(slugs=["Not A Slug"])
