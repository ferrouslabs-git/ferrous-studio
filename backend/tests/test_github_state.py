"""The signed ``state`` that carries the GitHub install flow.

This is the only thing standing between the install callback and an
unauthenticated POST that writes a row for any organisation an attacker names:
the callback has no bearer token and no scope headers, so the organisation it
acts as comes entirely from these claims. Everything here is therefore a
security test, not a serialisation test.

Pure functions, no database -- the rest of the suite has none either.
"""
import base64
import hashlib
import hmac
import json
import time
from dataclasses import replace

import pytest

from app.config import get_settings
from app.studio import github_client as gh

NONCE = "test-nonce-value"

ACCOUNT = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
PROJECT = "33333333-3333-4333-8333-333333333333"

# Only ever hashed into an HMAC key, never parsed as a key, so it does not have
# to be a real PEM -- the signing tests never reach jose.
FAKE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nnot-a-real-key\n-----END RSA PRIVATE KEY-----"


@pytest.fixture
def configured(monkeypatch):
    """A deployment with a GitHub App set up."""

    def _configure(private_key: str = FAKE_KEY):
        settings = replace(
            get_settings(),
            github_app_id="12345",
            github_app_slug="ferrous-studio",
            github_app_private_key=private_key,
            github_client_id="Iv1.abc",
            github_client_secret="secret",
        )
        monkeypatch.setattr(gh, "get_settings", lambda: settings)
        return settings

    return _configure


def test_state_round_trips(configured):
    configured()
    claims = gh.verify_state(gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=PROJECT, nonce=NONCE))
    assert claims["a"] == ACCOUNT
    assert claims["u"] == USER
    assert claims["p"] == PROJECT


def test_state_carries_no_project_when_none_was_given(configured):
    configured()
    claims = gh.verify_state(gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=None, nonce=NONCE))
    assert claims["p"] is None


def test_a_rewritten_organisation_is_rejected(configured):
    """The attack this exists to stop: keep a valid signature, swap the claims.

    Anyone can read a state out of their own address bar. If the payload could
    be edited without invalidating the signature, they could point the callback
    at somebody else's organisation and connect GitHub on its behalf.
    """
    configured()
    state = gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=None, nonce=NONCE)
    payload, signature = state.split(".", 1)

    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    claims["a"] = "99999999-9999-4999-8999-999999999999"
    forged = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode()).decode().rstrip("=")

    with pytest.raises(ValueError):
        gh.verify_state(f"{forged}.{signature}")


def test_a_state_signed_with_another_key_is_rejected(configured):
    """A state minted against a different App must not verify here."""
    configured("-----BEGIN RSA PRIVATE KEY-----\nother\n-----END RSA PRIVATE KEY-----")
    foreign = gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=None, nonce=NONCE)

    configured(FAKE_KEY)
    with pytest.raises(ValueError):
        gh.verify_state(foreign)


def test_an_expired_state_is_rejected(configured, monkeypatch):
    configured()
    state = gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=None, nonce=NONCE)
    # Well past STATE_TTL, without waiting for it. The real clock is captured
    # first: gh.time is the time module itself, so a lambda calling time.time()
    # after the patch would call its own replacement.
    later = time.time() + gh.STATE_TTL.total_seconds() + 60
    monkeypatch.setattr(gh.time, "time", lambda: later)
    with pytest.raises(ValueError):
        gh.verify_state(state)


@pytest.mark.parametrize("state", ["", "nonsense", "a.b.c", "onlyonepart", "!!!.???"])
def test_malformed_states_raise_rather_than_crash(configured, state):
    """The callback hands us whatever was in the URL; every shape must fail the
    same way, so the route has one thing to catch."""
    configured()
    with pytest.raises(ValueError):
        gh.verify_state(state)


def test_signing_without_an_app_configured_is_refused(monkeypatch):
    """No App means no key, and no key means an unsigned state -- which would be
    forgeable. Better to refuse than to sign with an empty string."""
    settings = replace(
        get_settings(),
        github_app_id="",
        github_app_slug="",
        github_app_private_key="",
        github_client_id="",
        github_client_secret="",
    )
    monkeypatch.setattr(gh, "get_settings", lambda: settings)
    assert not gh.configured()
    with pytest.raises(gh.GitHubNotConfigured):
        gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=None, nonce=NONCE)


def test_missing_settings_names_every_gap(monkeypatch):
    """The Repository section shows this list, so it has to be complete."""
    settings = replace(
        get_settings(),
        github_app_id="12345",
        github_app_slug="",
        github_app_private_key="",
        github_client_id="Iv1.abc",
        github_client_secret="",
    )
    monkeypatch.setattr(gh, "get_settings", lambda: settings)
    assert gh.missing_settings() == [
        "GITHUB_APP_SLUG",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_CLIENT_SECRET",
    ]


# ── The browser binding ─────────────────────────────────────────────────────
#
# A signature says a state came from us and names one organisation. It cannot
# say which browser is entitled to finish the flow -- and the state travels in
# a URL, so it turns up in history, Referer headers and logs. The nonce is the
# half that stays in an HttpOnly cookie.


def test_the_nonce_travels_inside_the_state(configured):
    configured()
    claims = gh.verify_state(gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=None, nonce=NONCE))
    assert claims["n"] == NONCE
    assert gh.nonce_matches(claims, NONCE)


def test_a_leaked_state_without_the_cookie_is_not_enough(configured):
    """The attack the cookie exists to stop.

    Someone who obtains another organisation's state -- from a shared link, a
    browser history, a Referer log -- could otherwise finish the install with
    their own GitHub installation and bind it to that organisation, displacing
    the real connection.
    """
    configured()
    claims = gh.verify_state(gh.sign_state(account_id=ACCOUNT, user_id=USER, project_id=None, nonce=NONCE))
    assert not gh.nonce_matches(claims, None)
    assert not gh.nonce_matches(claims, "")
    assert not gh.nonce_matches(claims, "a-different-browsers-nonce")


def test_a_state_with_no_nonce_is_refused(configured):
    """Fail closed. A state without a nonce could only predate the browser
    binding, and honouring one would reopen the hole it closed."""
    configured()
    stale = json.dumps(
        {"a": ACCOUNT, "u": USER, "p": None, "e": int(time.time() + 600)}, separators=(",", ":"), sort_keys=True
    ).encode()
    # Signed correctly, so only the missing nonce can be what rejects it.
    payload = base64.urlsafe_b64encode(stale).decode().rstrip("=")
    mac = hmac.new(hashlib.sha256(FAKE_KEY.encode()).digest(), stale, hashlib.sha256).digest()
    signature = base64.urlsafe_b64encode(mac).decode().rstrip("=")

    with pytest.raises(ValueError):
        gh.verify_state(f"{payload}.{signature}")


def test_nonces_are_unguessable_and_distinct():
    """Two flows must never share a nonce, or one browser's cookie would
    validate another's state."""
    nonces = {gh.new_nonce() for _ in range(100)}
    assert len(nonces) == 100
    assert all(len(n) >= 32 for n in nonces)
