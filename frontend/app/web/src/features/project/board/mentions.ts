// @-mentions in board comments (FS-REQ-80). A mention is stored in the
// comment's text as `@[user:<uuid>]` -- by id, so it survives a rename and
// always reads as whatever the person is called now (backend
// app/studio/board/mentions.py is the twin). The composer never shows the
// token: it shows "@Name" and remembers who each picked name stands for,
// swapping the two on the way in and out.

const TOKEN_SOURCE = "@\\[user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\]";

export const mentionToken = (userId: string) => `@[user:${userId}]`;

/** Someone picked in the composer: their "@Name" in the text stands for this id. */
export interface PickedMention {
  id: string;
  name: string;
}

export type CommentSegment = { kind: "text"; text: string } | { kind: "mention"; userId: string };

/** A stored comment as plain text and mentions, in order, for rendering. */
export function splitMentions(body: string): CommentSegment[] {
  const out: CommentSegment[] = [];
  const re = new RegExp(TOKEN_SOURCE, "g");
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) out.push({ kind: "text", text: body.slice(last, m.index) });
    out.push({ kind: "mention", userId: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

/** The ids a stored comment mentions, once each. */
export function mentionedIds(body: string): string[] {
  return [...new Set(splitMentions(body).flatMap((s) => (s.kind === "mention" ? [s.userId] : [])))];
}

/** A stored comment as the composer shows it, and who its "@Name"s are. */
export function toEditable(body: string, nameOf: (userId: string) => string): { text: string; picked: PickedMention[] } {
  const picked: PickedMention[] = [];
  const text = splitMentions(body)
    .map((s) => {
      if (s.kind === "text") return s.text;
      const name = nameOf(s.userId);
      if (!picked.some((p) => p.id === s.userId)) picked.push({ id: s.userId, name });
      return `@${name}`;
    })
    .join("");
  return { text, picked };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The composer's text as stored: every picked "@Name" still in it becomes
 * that person's token. Longest names first, so "@Ada Lovelace" is never read
 * as "@Ada" plus " Lovelace". A name deleted or retyped by hand is plain
 * text again -- only a pick makes a mention.
 */
export function toStored(text: string, picked: PickedMention[]): string {
  let out = text;
  const byLength = [...picked].sort((a, b) => b.name.length - a.name.length);
  for (const p of byLength) {
    if (!p.name) continue;
    out = out.replace(new RegExp(`@${escapeRe(p.name)}(?![\\p{L}\\p{N}_])`, "gu"), mentionToken(p.id));
  }
  return out;
}

/** The "@query" being typed just before the caret, if the caret is in one. */
export function activeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([^\s@][^@\n]{0,30})?$/u.exec(before);
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, query };
}

/** Who matches a query: names starting with it first, then containing it. */
export function matchPeople<T extends { name: string }>(people: T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, limit);
  const starts = people.filter((p) => p.name.toLowerCase().startsWith(q));
  const contains = people.filter((p) => !p.name.toLowerCase().startsWith(q) && p.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** ``text`` with the query at ``start`` (its "@" included) replaced by "@Name ". */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const insert = `@${name} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}
