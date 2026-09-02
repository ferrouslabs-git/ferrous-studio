import { describe, expect, it } from "vitest";
import { HistoryTimeline, HISTORY_LIMIT, HistoryEntry } from "./history";
import { PageRecord } from "./types";

/** Snapshots are opaque to the timeline; a stub with an id is enough. */
const rec = (pageId: string, tag: string) => ({ id: pageId, name: tag } as unknown as PageRecord);
const entry = (pageId: string, tag: string): HistoryEntry => ({
  pageId,
  before: rec(pageId, `${tag}-before`),
  after: rec(pageId, `${tag}-after`),
});

const always = () => true;

describe("HistoryTimeline", () => {
  it("undoes to before and redoes to after, in order", () => {
    const tl = new HistoryTimeline();
    const a = entry("pa", "a");
    const b = entry("pa", "b");
    tl.push(a);
    tl.push(b);

    expect(tl.canUndo()).toBe(true);
    expect(tl.canRedo()).toBe(false);
    expect(tl.step(-1, always)).toEqual({ pageId: "pa", target: b.before });
    expect(tl.step(-1, always)).toEqual({ pageId: "pa", target: a.before });
    expect(tl.canUndo()).toBe(false);
    expect(tl.step(1, always)).toEqual({ pageId: "pa", target: a.after });
    expect(tl.step(1, always)).toEqual({ pageId: "pa", target: b.after });
    expect(tl.step(1, always)).toBeNull();
  });

  it("keeps steps from different pages in one timeline", () => {
    const tl = new HistoryTimeline();
    const home = entry("home", "resize");
    const users = entry("users", "fill");
    tl.push(home);
    tl.push(users);

    // Undo reaches back across pages: newest first, each tagged with its page.
    expect(tl.step(-1, always)?.pageId).toBe("users");
    expect(tl.step(-1, always)?.pageId).toBe("home");
    expect(tl.step(1, always)?.pageId).toBe("home");
  });

  it("discards the redo branch on a new push", () => {
    const tl = new HistoryTimeline();
    tl.push(entry("pa", "a"));
    tl.push(entry("pa", "b"));
    tl.step(-1, always);
    tl.push(entry("pa", "c"));

    expect(tl.canRedo()).toBe(false);
    expect(tl.step(-1, always)?.target).toEqual(rec("pa", "c-before"));
    expect(tl.step(-1, always)?.target).toEqual(rec("pa", "a-before"));
  });

  it("coalesces only into the tip entry of the same page", () => {
    const tl = new HistoryTimeline();
    expect(tl.coalesce(rec("pa", "x"))).toBe(false); // nothing to fold into

    tl.push(entry("pa", "a"));
    expect(tl.coalesce(rec("pb", "x"))).toBe(false); // different page
    expect(tl.coalesce(rec("pa", "a2-after"))).toBe(true);
    expect(tl.step(-1, always)?.target).toEqual(rec("pa", "a-before"));
    // After an undo the entry is no longer the tip, so nothing coalesces.
    expect(tl.coalesce(rec("pa", "x"))).toBe(false);
  });

  it("skips and discards entries whose page has been deleted", () => {
    const tl = new HistoryTimeline();
    tl.push(entry("dead", "a"));
    tl.push(entry("live", "b"));
    tl.push(entry("dead", "c"));

    const exists = (id: string) => id !== "dead";
    expect(tl.step(-1, exists)?.pageId).toBe("live");
    expect(tl.step(-1, exists)).toBeNull();
    expect(tl.canUndo()).toBe(false);
    // The live entry is still redoable; the dead ones are gone for good.
    expect(tl.step(1, exists)?.pageId).toBe("live");
    expect(tl.step(1, exists)).toBeNull();
  });

  it("rolls back a step that could not be applied", () => {
    const tl = new HistoryTimeline();
    tl.push(entry("pa", "a"));
    tl.step(-1, always);
    tl.rollback(-1);

    expect(tl.canUndo()).toBe(true);
    expect(tl.canRedo()).toBe(false);
  });

  it("drops one page's entries and keeps the cursor consistent", () => {
    const tl = new HistoryTimeline();
    tl.push(entry("pa", "a"));
    tl.push(entry("pb", "b"));
    tl.push(entry("pa", "c"));
    tl.step(-1, always); // c is now undone

    tl.dropPage("pa");
    expect(tl.canUndo()).toBe(true); // b survives, still applied
    expect(tl.step(-1, always)?.pageId).toBe("pb");
    expect(tl.canUndo()).toBe(false);
    expect(tl.canRedo()).toBe(true);
    expect(tl.step(1, always)?.pageId).toBe("pb");
    expect(tl.step(1, always)).toBeNull();
  });

  it("sheds the oldest entry beyond the limit", () => {
    const tl = new HistoryTimeline();
    for (let i = 0; i <= HISTORY_LIMIT; i++) tl.push(entry("pa", `e${i}`));

    let steps = 0;
    while (tl.step(-1, always)) steps++;
    expect(steps).toBe(HISTORY_LIMIT);
    // The oldest entry (e0) fell off; the undo floor is e1's before-state.
    expect(tl.canUndo()).toBe(false);
  });
});
