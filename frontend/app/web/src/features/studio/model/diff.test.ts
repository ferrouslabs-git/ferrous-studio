import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { applyOps, byPos, PageLike } from "./applyOps";
import { diffPage } from "./diff";
import { PageDocument, SplitNode } from "./types";

function page(): PageLike {
  const document: PageDocument = {
    root: {
      kind: "split",
      id: "s1",
      dir: "col",
      size: { fr: 1 },
      children: [
        { kind: "region", id: "rh", label: "Header", size: "auto" },
        {
          kind: "split",
          id: "s2",
          dir: "row",
          size: { fr: 1 },
          children: [
            { kind: "region", id: "rs", size: 260 },
            { kind: "region", id: "rm", size: { fr: 1 } },
          ],
        },
      ],
    },
    regions: {
      rh: [{ id: "c1", type: "navbar", label: "App", pos: "a0" }],
      rs: [],
      rm: [
        { id: "c2", type: "list", label: "Directory", pos: "a0", props: { columns: ["Name"] } },
        { id: "c3", type: "kpi", label: "Stats", pos: "a1" },
      ],
    },
  };
  return { name: "Users", route: "/users", pos: "a0", document };
}

/** Round-trip property: applying the diff to `prev` must reproduce `next`. */
function roundTrip(prev: PageLike, next: PageLike) {
  const ops = diffPage(prev, next);
  expect(applyOps(prev, ops)).toEqual(next);
  return ops;
}

describe("diffPage", () => {
  it("emits nothing for identical state", () => {
    const p = page();
    expect(diffPage(p, p)).toEqual([]);
  });

  it("sets changed component fields by id, not index", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      d.document.regions.rm[0].props = { columns: ["Name", "Email"] };
    });
    const ops = roundTrip(prev, next);
    expect(ops).toEqual([{ op: "set", target: { cmp: "c2" }, path: "props", value: { columns: ["Name", "Email"] } }]);
  });

  it("detects inserts, removes and moves between regions", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      const [c3] = d.document.regions.rm.splice(1, 1);
      c3.pos = "a0";
      d.document.regions.rs.push(c3);
      d.document.regions.rh.splice(0, 1);
      d.document.regions.rm.push({ id: "c9", type: "footer", label: "Footer", pos: "a5" });
    });
    const ops = roundTrip(prev, next);
    expect(ops).toContainEqual({ op: "remove", target: { cmp: "c1" } });
    expect(ops).toContainEqual({ op: "move", target: { cmp: "c3" }, to: { region: "rs", pos: "a0" } });
    expect(ops).toContainEqual({ op: "insert", into: { region: "rm" }, value: { id: "c9", type: "footer", label: "Footer", pos: "a5" } });
  });

  it("reorders within a region as a pos-only move", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      d.document.regions.rm[1].pos = "Zz";
    });
    expect(roundTrip(prev, next)).toEqual([{ op: "move", target: { cmp: "c3" }, to: { pos: "Zz" } }]);
  });

  it("emits the tree set before inserts into a new region", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      const s2 = (d.document.root as SplitNode).children[1] as SplitNode;
      s2.children.push({ kind: "region", id: "rp", size: 300 });
      d.document.regions.rp = [{ id: "c8", type: "rightpanel-detail", label: "Detail", pos: "a0" }];
    });
    const ops = roundTrip(prev, next);
    const rootIdx = ops.findIndex((o) => o.op === "set" && o.path === "root");
    const insertIdx = ops.findIndex((o) => o.op === "insert");
    expect(rootIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(rootIdx);
  });

  it("handles page fields and the undo direction", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      d.name = "People";
      d.document.regions.rm.splice(0, 1);
    });
    const ops = roundTrip(prev, next);
    expect(ops).toContainEqual({ op: "set", path: "name", value: "People" });
    // Undo direction: applying the reverse diff restores the same content in
    // pos order (array order after a replayed insert may differ; reads sort).
    const back = diffPage(next, prev);
    expect(back.some((o) => o.op === "insert")).toBe(true);
    const restored = applyOps(next, back);
    expect(byPos(restored.document.regions.rm).map((c) => c.id)).toEqual(byPos(prev.document.regions.rm).map((c) => c.id));
  });
});
