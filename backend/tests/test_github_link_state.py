"""What the Repository section reports when the link and GitHub disagree.

``link_state`` is the one place that decides this, and it is a pure function of
a ``LinkReading`` precisely so it can be pinned down here without a database or
a network. The ordering is the substance: each question only makes sense once
the one before it is answered, and getting that order wrong produces confident
nonsense -- "the installation cannot see this repository" on a deployment that
has no GitHub App at all.
"""
from app.studio.github import LinkReading, link_state
from app.studio.github_client import GitHubError, Repository

REPO = Repository(
    id=42,
    full_name="ferrouslabs/studio",
    private=True,
    default_branch="main",
    html_url="https://github.com/ferrouslabs/studio",
    description="Visual spec builder",
    pushed_at="2026-09-06T10:00:00Z",
)


def reading(**overrides) -> LinkReading:
    """A healthy, linked, reachable repository -- override one thing per test."""
    base = dict(
        stored_id=REPO.id,
        stored_full_name=REPO.full_name,
        configured=True,
        connected=True,
        repo=REPO,
        error=None,
    )
    return LinkReading(**{**base, **overrides})


def test_a_healthy_link_says_nothing():
    """"ok" carries no sentence: there is nothing to report."""
    assert link_state(reading()) == ("ok", None)


def test_no_repository_linked():
    assert link_state(reading(stored_id=None, stored_full_name=None)) == ("unlinked", None)


def test_unlinked_wins_even_when_github_is_unavailable():
    """A project with no link is not a broken link.

    The deployment having no GitHub App is irrelevant to a project that never
    named a repository, and reporting "unavailable" here would invent a problem.
    """
    state, _ = link_state(reading(stored_id=None, stored_full_name=None, configured=False, repo=None))
    assert state == "unlinked"


def test_no_github_app_on_this_deployment():
    state, message = link_state(reading(configured=False, connected=False, repo=None))
    assert state == "unavailable"
    assert "not configured" in message


def test_app_exists_but_the_organisation_has_not_connected():
    state, message = link_state(reading(connected=False, repo=None))
    assert state == "disconnected"
    assert "not connected" in message


def test_unavailable_is_reported_before_disconnected():
    """Both are false when there is no App; the deployment-level fact is the
    one worth saying, since connecting is impossible until it is fixed."""
    state, _ = link_state(reading(configured=False, connected=False, repo=None))
    assert state == "unavailable"


def test_a_repository_the_installation_can_no_longer_see():
    """404 is the ordinary ending: deleted, or dropped from the installation's
    selected repositories. The sentence names it, and stops there."""
    state, message = link_state(reading(repo=None, error=GitHubError("Not Found", status=404)))
    assert state == "unreachable"
    assert "ferrouslabs/studio" in message
    assert message.endswith(".")


def test_a_404_with_no_stored_name_still_reads_as_a_sentence():
    state, message = link_state(
        reading(stored_full_name=None, repo=None, error=GitHubError("Not Found", status=404))
    )
    assert state == "unreachable"
    assert "this repository" in message


def test_github_having_a_bad_day_is_quoted_rather_than_paraphrased():
    """A 500 is not "the repository is gone", and guessing would mislead."""
    state, message = link_state(reading(repo=None, error=GitHubError("Server Error", status=500)))
    assert state == "unreachable"
    assert message == "Server Error"


def test_no_answer_and_no_error_still_produces_a_sentence():
    """Defensive: every non-ok state owes the page something to show."""
    state, message = link_state(reading(repo=None))
    assert state == "unreachable"
    assert message


def test_a_rename_is_not_a_state():
    """The link is held by id, so a rename does not break it.

    GitHub's name differs from the stored one here and the answer is still
    plain "ok" -- the caller refreshes the cached name and says nothing.
    """
    assert link_state(reading(stored_full_name="ferrouslabs/old-name")) == ("ok", None)


def test_every_state_is_one_the_schema_declares():
    """The response model pins these as a Literal; a typo would only surface as
    a serialisation error at runtime, on the one path that is hardest to reach."""
    from typing import get_args

    from app.studio.schemas import ProjectRepositoryRead

    allowed = set(get_args(ProjectRepositoryRead.model_fields["state"].annotation))
    produced = {
        link_state(reading())[0],
        link_state(reading(stored_id=None))[0],
        link_state(reading(configured=False, connected=False, repo=None))[0],
        link_state(reading(connected=False, repo=None))[0],
        link_state(reading(repo=None, error=GitHubError("Not Found", status=404)))[0],
    }
    assert produced <= allowed
    # And nothing declared is unreachable: "renamed" was removed when renames
    # became silent, and the union should not grow one back unnoticed.
    assert allowed == produced
