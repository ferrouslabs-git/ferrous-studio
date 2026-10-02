"""Slack: the parts that decide who is trusted, and what is announced.

Three things here are security tests rather than serialisation tests:

  * the signed ``state`` -- the OAuth callback has no bearer token, so the
    organisation it acts as comes entirely from these claims;
  * ``verify_request`` -- the interactivity route has no caller identity at all,
    only a signature;
  * the token key -- a bot token must round-trip through Fernet and must not
    decrypt under another environment's key.

And one behavioural test: an event is released for posting only when its
transaction commits, and discarded when it rolls back.

Pure functions plus one in-memory SQLite session -- the suite has no Postgres.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import replace
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import get_settings
from app.studio import slack, slack_client as sc, slack_notify

ACCOUNT = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
NONCE = "test-nonce-value"
SIGNING_SECRET = "signing-secret-for-tests"


@pytest.fixture
def configured(monkeypatch):
    def _configure(**overrides):
        values = {
            "slack_client_id": "123.456",
            "slack_client_secret": "client-secret",
            "slack_signing_secret": SIGNING_SECRET,
            "slack_token_key": Fernet.generate_key().decode(),
            **overrides,
        }
        settings = replace(get_settings(), **values)
        monkeypatch.setattr(sc, "get_settings", lambda: settings)
        return settings

    return _configure


# ── Configuration ──────────────────────────────────────────────────────────


def test_unconfigured_reports_every_missing_setting(monkeypatch):
    monkeypatch.setattr(
        sc,
        "get_settings",
        lambda: replace(
            get_settings(), slack_client_id="", slack_client_secret="", slack_signing_secret="", slack_token_key=""
        ),
    )
    assert not sc.configured()
    assert sc.missing_settings() == [
        "SLACK_CLIENT_ID",
        "SLACK_CLIENT_SECRET",
        "SLACK_SIGNING_SECRET",
        "SLACK_TOKEN_KEY",
    ]


def test_one_missing_setting_is_enough_to_be_unconfigured(configured):
    configured(slack_signing_secret="")
    assert sc.missing_settings() == ["SLACK_SIGNING_SECRET"]


# ── State ──────────────────────────────────────────────────────────────────


def test_state_round_trips(configured):
    configured()
    claims = sc.verify_state(sc.sign_state(account_id=ACCOUNT, user_id=USER, nonce=NONCE))
    assert claims["a"] == ACCOUNT and claims["u"] == USER and claims["n"] == NONCE


def test_state_rejects_a_tampered_account(configured):
    configured()
    encoded, signature = sc.sign_state(account_id=ACCOUNT, user_id=USER, nonce=NONCE).split(".")
    claims = json.loads(sc._unb64(encoded))
    claims["a"] = "99999999-9999-4999-8999-999999999999"
    forged = sc._b64(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
    with pytest.raises(ValueError, match="signature"):
        sc.verify_state(f"{forged}.{signature}")


def test_state_signed_with_another_secret_is_refused(configured):
    configured()
    state = sc.sign_state(account_id=ACCOUNT, user_id=USER, nonce=NONCE)
    configured(slack_client_secret="a-different-secret")
    with pytest.raises(ValueError, match="signature"):
        sc.verify_state(state)


def test_expired_state_is_refused(configured, monkeypatch):
    configured()
    state = sc.sign_state(account_id=ACCOUNT, user_id=USER, nonce=NONCE)
    later = time.time() + sc.STATE_TTL.total_seconds() + 5
    monkeypatch.setattr(sc.time, "time", lambda: later)
    with pytest.raises(ValueError, match="expired"):
        sc.verify_state(state)


@pytest.mark.parametrize("junk", ["", "no-dot", "a.b", "....", "!!!.???"])
def test_malformed_state_is_refused(configured, junk):
    configured()
    with pytest.raises(ValueError):
        sc.verify_state(junk)


def test_state_without_a_nonce_is_refused(configured):
    configured()
    payload = json.dumps({"a": ACCOUNT, "u": USER, "e": int(time.time()) + 60}, separators=(",", ":"), sort_keys=True).encode()
    signature = hmac.new(sc._state_key(), payload, hashlib.sha256).digest()
    with pytest.raises(ValueError, match="nonce"):
        sc.verify_state(f"{sc._b64(payload)}.{sc._b64(signature)}")


def test_nonce_must_match_the_cookie(configured):
    claims = {"n": NONCE}
    assert sc.nonce_matches(claims, NONCE)
    assert not sc.nonce_matches(claims, "another")
    assert not sc.nonce_matches(claims, None)
    assert not sc.nonce_matches({}, NONCE)


# ── Install URL ────────────────────────────────────────────────────────────


def test_install_url_asks_for_the_scopes_we_use(configured):
    configured()
    url = sc.install_url("the-state")
    assert url.startswith(sc.AUTHORIZE_URL)
    assert "client_id=123.456" in url
    assert "state=the-state" in url
    for scope in sc.SCOPES:
        assert scope.replace(":", "%3A") in url


# ── Request signature ──────────────────────────────────────────────────────


def _sign(body: bytes, timestamp: str, secret: str = SIGNING_SECRET) -> str:
    return "v0=" + hmac.new(secret.encode(), b"v0:" + timestamp.encode() + b":" + body, hashlib.sha256).hexdigest()


def test_a_correctly_signed_request_is_accepted(configured):
    configured()
    now = time.time()
    ts = str(int(now))
    body = b"payload=%7B%7D"
    assert sc.verify_request(ts, body, _sign(body, ts), now=now)


def test_a_wrong_signature_is_refused(configured):
    configured()
    now = time.time()
    ts = str(int(now))
    assert not sc.verify_request(ts, b"payload=1", _sign(b"payload=2", ts), now=now)


def test_a_signature_from_another_secret_is_refused(configured):
    configured()
    now = time.time()
    ts = str(int(now))
    body = b"payload=1"
    assert not sc.verify_request(ts, body, _sign(body, ts, secret="someone-elses"), now=now)


def test_a_replayed_old_request_is_refused(configured):
    configured()
    now = time.time()
    ts = str(int(now) - sc.REQUEST_MAX_AGE_SECONDS - 10)
    body = b"payload=1"
    assert not sc.verify_request(ts, body, _sign(body, ts), now=now)


@pytest.mark.parametrize("timestamp,signature", [(None, "v0=x"), ("1", None), ("not-a-number", "v0=x"), ("", "")])
def test_missing_or_garbled_headers_are_refused(configured, timestamp, signature):
    configured()
    assert not sc.verify_request(timestamp, b"x", signature)


def test_nothing_verifies_without_a_signing_secret(configured):
    configured(slack_signing_secret="")
    now = time.time()
    ts = str(int(now))
    assert not sc.verify_request(ts, b"x", _sign(b"x", ts, secret=""), now=now)


# ── Token at rest ──────────────────────────────────────────────────────────


def test_token_round_trips_and_is_not_stored_in_clear(configured):
    configured()
    stored = sc.encrypt_token("xoxb-secret-token")
    assert "xoxb" not in stored
    assert sc.decrypt_token(stored) == "xoxb-secret-token"


def test_token_does_not_decrypt_under_another_key(configured):
    configured()
    stored = sc.encrypt_token("xoxb-secret-token")
    configured()  # a fresh key
    with pytest.raises(sc.SlackError, match="reconnect"):
        sc.decrypt_token(stored)


def test_an_invalid_key_is_reported_as_not_configured(configured):
    configured(slack_token_key="not-a-fernet-key")
    with pytest.raises(sc.SlackNotConfigured):
        sc.encrypt_token("x")


# ── Wording ────────────────────────────────────────────────────────────────


def test_escape_defuses_mentions_and_links():
    assert slack_notify.escape("<!channel> & <@U123>") == "&lt;!channel&gt; &amp; &lt;@U123&gt;"


def test_clip_collapses_whitespace_and_truncates():
    assert slack_notify.clip("a\n\n  b") == "a b"
    clipped = slack_notify.clip("x" * 500, 20)
    assert len(clipped) == 20 and clipped.endswith("…")


@pytest.mark.parametrize(
    "action,detail,expected",
    [
        ("requirement.updated", {"status": {"from": "NotStarted", "to": "InProgress"}}, True),
        ("requirement.updated", {"title": {"from": "a", "to": "b"}}, False),
        ("requirement.updated", {}, False),
        ("requirement.created", {"title": "x"}, False),
        ("feedback.created", {}, True),
        ("comment.created", {"excerpt": "hi"}, True),
        ("comment.deleted", {}, False),
        ("epic.updated", {"status": {}}, False),
    ],
)
def test_only_the_agreed_events_are_announced(action, detail, expected):
    assert slack_notify.wants(action, detail) is expected


def _approval(status="pending", **extra):
    return SimpleNamespace(
        id=uuid.UUID("33333333-3333-4333-8333-333333333333"),
        account_id=uuid.UUID(ACCOUNT),
        summary=extra.get("summary", "Delete the staging seed data"),
        detail=extra.get("detail", ""),
        status=status,
        decided_by=extra.get("decided_by"),
    )


def test_a_pending_approval_offers_both_buttons_carrying_the_account():
    blocks = slack.approval_blocks(_approval())
    actions = next(b for b in blocks if b["type"] == "actions")
    ids = {e["action_id"] for e in actions["elements"]}
    assert ids == {slack.APPROVE_ACTION, slack.REJECT_ACTION}
    for element in actions["elements"]:
        account, approval = element["value"].split(":")
        assert account == ACCOUNT and approval == "33333333-3333-4333-8333-333333333333"


def test_a_decided_approval_has_no_buttons_and_names_who_decided():
    blocks = slack.approval_blocks(_approval("approved", decided_by="elliott"))
    assert not any(b["type"] == "actions" for b in blocks)
    assert "Approved by elliott" in json.dumps(blocks)


def test_approval_text_cannot_smuggle_a_mention():
    blocks = slack.approval_blocks(_approval(summary="<!channel> do it", detail="<@U1>"))
    rendered = json.dumps(blocks)
    assert "<!channel>" not in rendered and "<@U1>" not in rendered


# ── Released on commit, discarded on rollback ──────────────────────────────


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    with Session(engine) as s:
        yield s


def _stage(session, action="comment.created", detail=None):
    board = SimpleNamespace(account_id=uuid.UUID(ACCOUNT), id=uuid.uuid4())
    slack_notify.stage(session, board, None, action, "requirement", uuid.uuid4(), detail or {"excerpt": "hi"})


async def test_staged_events_are_dispatched_after_commit(session, monkeypatch):
    batches = []

    async def fake_dispatch(batch):
        batches.append(batch)

    monkeypatch.setattr(slack_notify, "dispatch", fake_dispatch)
    _stage(session)
    assert batches == []  # nothing before the commit
    session.commit()
    await asyncio.sleep(0)
    await asyncio.gather(*list(slack_notify._tasks))
    assert len(batches) == 1 and batches[0][0].action == "comment.created"
    assert slack_notify.STAGED_KEY not in session.info


async def test_staged_events_are_discarded_on_rollback(session, monkeypatch):
    batches = []

    async def fake_dispatch(batch):
        batches.append(batch)

    monkeypatch.setattr(slack_notify, "dispatch", fake_dispatch)
    session.connection()  # begin, so there is a transaction to roll back
    _stage(session)
    session.rollback()
    session.commit()
    await asyncio.sleep(0)
    assert batches == []


def test_an_unwanted_event_is_not_even_staged(session):
    _stage(session, action="epic.updated", detail={"title": {"from": "a", "to": "b"}})
    assert slack_notify.STAGED_KEY not in session.info


async def test_dispatch_never_raises_and_does_nothing_unconfigured(monkeypatch):
    monkeypatch.setattr(slack_notify.slack_client, "configured", lambda: False)
    ev = slack_notify.StagedEvent(uuid.UUID(ACCOUNT), uuid.uuid4(), None, "comment.created", "requirement", uuid.uuid4(), {})
    await slack_notify.dispatch([ev])  # no database, no Slack: must simply return
