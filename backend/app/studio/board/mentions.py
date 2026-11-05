"""@-mentions in board comments (FS-REQ-80).

A mention is stored in the comment's own text as ``@[user:<uuid>]`` -- by id,
never by name, so it survives the person renaming themselves and always
renders as whatever they are called now. The composer shows ``@Name`` while
typing and swaps it for the token on save; readers (the board, Slack) swap
it back.

Each comment remembers who it has already told (``Comment.mentioned_user_ids``),
so an edit only notifies the people it newly mentions -- removing a mention
and adding it back later does not ping them twice.
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from uuid import UUID

MENTION_RE = re.compile(r"@\[user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]")

#: How a mention of someone no longer known reads.
UNKNOWN = "someone"


def token(user_id: UUID | str) -> str:
    return f"@[user:{user_id}]"


def mentioned_ids(body: str | None) -> list[UUID]:
    """Everyone ``body`` mentions, in order of first mention, once each."""
    out: list[UUID] = []
    for match in MENTION_RE.finditer(body or ""):
        uid = UUID(match.group(1))
        if uid not in out:
            out.append(uid)
    return out


def to_notify(
    body: str | None,
    already: Iterable[str | UUID],
    author_id: UUID | None,
    mentionable: Iterable[UUID],
) -> list[UUID]:
    """Who saving ``body`` should tell: mentioned now, able to see the item
    (``mentionable``), not told before by this comment, and not its author."""
    told = {str(u) for u in already}
    allowed = set(mentionable)
    return [
        uid for uid in mentioned_ids(body)
        if uid in allowed and str(uid) not in told and uid != author_id
    ]


def render(body: str | None, names: Mapping[UUID, str]) -> str:
    """``body`` with each mention read as ``@Name``."""
    return MENTION_RE.sub(lambda m: "@" + (names.get(UUID(m.group(1))) or UNKNOWN), body or "")
