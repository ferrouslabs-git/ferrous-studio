"""@-mentions in requirement and feedback comments (FS-REQ-80).

A mention is a token in the comment body naming a user id; saving a comment
tells each newly mentioned person through Slack, once per comment, and a
failed Slack send never touches the save. Pure functions and stubs, no
database -- like the rest of the suite.
"""
import asyncio
import types
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.studio import slack_notify
from app.studio.board import mentions, routes
from app.studio.board.models import Comment

ADA = uuid.UUID("11111111-1111-4111-8111-111111111111")
BOB = uuid.UUID("22222222-2222-4222-8222-222222222222")
CY = uuid.UUID("33333333-3333-4333-8333-333333333333")
AUTHOR = uuid.UUID("44444444-4444-4444-8444-444444444444")
STRANGER = uuid.UUID("55555555-5555-4555-8555-555555555555")
ACCOUNT = uuid.UUID("66666666-6666-4666-8666-666666666666")
EVERYONE = {ADA, BOB, CY, AUTHOR}


def t(uid):
    return mentions.token(uid)


# ── Parsing and rendering ────────────────────────────────────────────────


def test_mentions_are_found_in_order_once_each():
    body = f"{t(BOB)} and {t(ADA)}, then {t(BOB)} again"
    assert mentions.mentioned_ids(body) == [BOB, ADA]


@pytest.mark.parametrize("body", ["", None, "@Ada no token", "@[user:not-a-uuid]", "@[user:1234]", "email@[user]"])
def test_text_without_a_well_formed_token_mentions_nobody(body):
    assert mentions.mentioned_ids(body) == []


def test_rendering_uses_current_names_and_survives_unknown_people():
    body = f"{t(ADA)} can you check with {t(STRANGER)}?"
    assert mentions.render(body, {ADA: "Ada Lovelace"}) == "@Ada Lovelace can you check with @someone?"


def test_a_token_round_trips():
    assert mentions.mentioned_ids(t(ADA)) == [ADA]


# ── Who is told ──────────────────────────────────────────────────────────


def test_only_new_visible_others_are_notified():
    body = f"{t(ADA)} {t(BOB)} {t(AUTHOR)} {t(STRANGER)}"
    # BOB was told by an earlier save; AUTHOR wrote it; STRANGER cannot see the board.
    assert mentions.to_notify(body, [str(BOB)], AUTHOR, EVERYONE) == [ADA]


class FakeDb:
    def __init__(self):
        self.sync_session = object()


@pytest.fixture
def staged(monkeypatch):
    calls = []

    def fake_stage(session, board, actor_id, comment, user_ids):
        calls.append(list(user_ids))

    monkeypatch.setattr(routes.slack_notify, "stage_mentions", fake_stage)
    return calls


def _save(comment, body, staged_calls):
    comment.body = body
    names = {u: "x" for u in EVERYONE}
    routes._stage_mentions(FakeDb(), types.SimpleNamespace(), types.SimpleNamespace(user_id=AUTHOR), comment, names)
    return staged_calls[-1] if staged_calls else None


def test_editing_a_comment_notifies_only_the_newly_mentioned(staged):
    comment = Comment(id=uuid.uuid4(), entity_type="requirement", entity_id=uuid.uuid4(), mentioned_user_ids=[])
    assert _save(comment, f"{t(ADA)} please look", staged) == [ADA]
    assert _save(comment, f"{t(ADA)} and {t(BOB)} please look", staged) == [BOB]
    assert len(staged) == 2
    # A typo fix, a mention removed and put back: nobody is told twice.
    _save(comment, f"{t(ADA)} and {t(BOB)} please take a look", staged)
    _save(comment, "please take a look", staged)
    _save(comment, f"{t(BOB)} {t(ADA)} please take a look", staged)
    assert len(staged) == 2
    assert comment.mentioned_user_ids == [str(ADA), str(BOB)]


def test_the_author_mentioning_themselves_is_not_notified(staged):
    comment = Comment(id=uuid.uuid4(), entity_type="feedback", entity_id=uuid.uuid4(), mentioned_user_ids=[])
    _save(comment, f"note to self {t(AUTHOR)}", staged)
    assert staged == [] and comment.mentioned_user_ids == []


def test_create_and_edit_both_stage_mentions():
    import inspect

    for fn in (routes.create_comment, routes.update_comment):
        assert "_stage_mentions(db, board, ctx, comment, names)" in inspect.getsource(fn), fn.__name__


# ── Slack ────────────────────────────────────────────────────────────────


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    with Session(engine) as s:
        yield s


def test_each_mention_is_staged_as_a_personal_message(session):
    board = types.SimpleNamespace(account_id=ACCOUNT, id=uuid.uuid4())
    comment = types.SimpleNamespace(id=uuid.uuid4(), entity_type="feedback", entity_id=uuid.uuid4())
    slack_notify.stage_mentions(session, board, AUTHOR, comment, [ADA, BOB])
    staged = session.info[slack_notify.STAGED_KEY]
    assert [e.action for e in staged] == ["mentioned", "mentioned"]
    assert [e.detail["user_id"] for e in staged] == [str(ADA), str(BOB)]
    assert all(e.detail["comment_id"] == str(comment.id) and e.entity_type == "feedback" for e in staged)
    assert "mentioned" in slack_notify.PERSONAL


async def test_the_mention_message_says_who_where_and_what(monkeypatch):
    comment_id, req_id = uuid.uuid4(), uuid.uuid4()
    body = f"{t(ADA)} this breaks when {t(BOB)} imports <!channel>"

    class Db:
        async def get(self, model, key):
            if model is Comment:
                return types.SimpleNamespace(id=comment_id, body=body, deleted_at=None)
            return types.SimpleNamespace(id=key, account_id=ACCOUNT)

    async def project_url(db, board):
        return "Invoices", "https://studio/p", "https://studio/p/epics"

    async def entity_link(db, ev, base, epics_url):
        return f"{epics_url}/E1?req={req_id}", "FS-REQ-12", "Bulk import"

    async def names(db, account_id, ids):
        return {ADA: "Ada", BOB: "Bob"}

    async def who(db, user_id):
        return "Cy"

    monkeypatch.setattr(slack_notify, "remember_board_key", lambda board: None)
    monkeypatch.setattr(slack_notify, "_project_url", project_url)
    monkeypatch.setattr(slack_notify, "_entity_link", entity_link)
    monkeypatch.setattr(slack_notify, "mention_names", names)
    monkeypatch.setattr(slack_notify, "_who", who)
    ev = slack_notify.StagedEvent(
        ACCOUNT, uuid.uuid4(), CY, "mentioned", "requirement", req_id, {"user_id": str(ADA), "comment_id": str(comment_id)}
    )
    text, blocks = await slack_notify.describe(Db(), ev)
    line = blocks[0]["text"]["text"]
    assert text == "Cy mentioned you on FS-REQ-12"
    assert f"<https://studio/p/epics/E1?req={req_id}|FS-REQ-12>" in line
    assert "Bulk import" in line and "Cy mentioned " in line
    assert "@Ada this breaks when @Bob imports" in line
    assert "<!channel>" not in line  # a comment cannot smuggle a Slack broadcast
    assert slack_notify.RECIPIENT in line  # "you" in a DM, their name in the channel


async def test_the_mention_fallback_text_cannot_broadcast(monkeypatch):
    """The notification preview (fallback text) is escaped like the blocks: a
    display name of ``<!channel>`` must not ping the whole channel."""
    comment_id = uuid.uuid4()

    class Db:
        async def get(self, model, key):
            if model is Comment:
                return types.SimpleNamespace(id=comment_id, body=f"{t(ADA)} look", deleted_at=None)
            return types.SimpleNamespace(id=key, account_id=ACCOUNT)

    async def project_url(db, board):
        return "Invoices", "https://studio/p", "https://studio/p/epics"

    async def entity_link(db, ev, base, epics_url):
        return "https://studio/p/epics", "FS-REQ-<!here>", "Bulk import"

    async def names(db, account_id, ids):
        return {ADA: "Ada"}

    async def who(db, user_id):
        return "<!channel>"

    monkeypatch.setattr(slack_notify, "remember_board_key", lambda board: None)
    monkeypatch.setattr(slack_notify, "_project_url", project_url)
    monkeypatch.setattr(slack_notify, "_entity_link", entity_link)
    monkeypatch.setattr(slack_notify, "mention_names", names)
    monkeypatch.setattr(slack_notify, "_who", who)
    ev = slack_notify.StagedEvent(
        ACCOUNT, uuid.uuid4(), CY, "mentioned", "requirement", uuid.uuid4(), {"user_id": str(ADA), "comment_id": str(comment_id)}
    )
    text, _ = await slack_notify.describe(Db(), ev)
    assert "<!channel>" not in text and "<!here>" not in text


async def test_a_deleted_comment_sends_nothing(monkeypatch):
    class Db:
        async def get(self, model, key):
            if model is Comment:
                return None
            return types.SimpleNamespace(id=key, account_id=ACCOUNT)

    async def project_url(db, board):
        return None, None, None

    async def who(db, user_id):
        return "Cy"

    monkeypatch.setattr(slack_notify, "remember_board_key", lambda board: None)
    monkeypatch.setattr(slack_notify, "_project_url", project_url)
    monkeypatch.setattr(slack_notify, "_who", who)
    ev = slack_notify.StagedEvent(ACCOUNT, uuid.uuid4(), CY, "mentioned", "feedback", uuid.uuid4(), {"user_id": str(ADA), "comment_id": str(uuid.uuid4())})
    assert await slack_notify.describe(Db(), ev) is None


async def test_one_failed_send_neither_raises_nor_stops_the_others(monkeypatch):
    import app.studio.common as common

    delivered = []

    @asynccontextmanager
    async def fake_session():
        yield object()

    async def noop(*a, **k):
        return None

    async def connection(db, account_id):
        return types.SimpleNamespace(channel_id="C1", bot_token="enc")

    async def describe(db, ev):
        return "text", []

    async def deliver(db, token, channel, ev, text, blocks):
        if ev.detail["user_id"] == str(ADA):
            raise RuntimeError("users_not_found")
        delivered.append(ev.detail["user_id"])

    monkeypatch.setattr(slack_notify.slack_client, "configured", lambda: True)
    monkeypatch.setattr(slack_notify.slack_client, "decrypt_token", lambda t: "tok")
    monkeypatch.setattr(slack_notify, "AsyncSessionLocal", fake_session)
    monkeypatch.setattr(common, "adopt_account_scope", noop)
    monkeypatch.setattr(slack_notify, "connection_for", connection)
    monkeypatch.setattr(slack_notify, "describe", describe)
    monkeypatch.setattr(slack_notify, "_deliver_to", deliver)
    batch = [
        slack_notify.StagedEvent(ACCOUNT, uuid.uuid4(), CY, "mentioned", "requirement", uuid.uuid4(), {"user_id": str(u), "comment_id": "c"})
        for u in (ADA, BOB)
    ]
    await slack_notify.dispatch(batch)  # must not raise
    assert delivered == [str(BOB)]


async def test_mentions_reach_slack_only_after_the_comment_commits(session, monkeypatch):
    batches = []

    async def fake_dispatch(batch):
        batches.append(batch)

    monkeypatch.setattr(slack_notify, "dispatch", fake_dispatch)
    board = types.SimpleNamespace(account_id=ACCOUNT, id=uuid.uuid4())
    comment = types.SimpleNamespace(id=uuid.uuid4(), entity_type="requirement", entity_id=uuid.uuid4())
    session.connection()
    slack_notify.stage_mentions(session, board, AUTHOR, comment, [ADA])
    session.rollback()  # the save failed: nobody is told
    session.commit()
    await asyncio.sleep(0)
    assert batches == []
    slack_notify.stage_mentions(session, board, AUTHOR, comment, [ADA])
    session.commit()
    await asyncio.sleep(0)
    await asyncio.gather(*list(slack_notify._tasks))
    assert [e.action for e in batches[0]] == ["mentioned"]
