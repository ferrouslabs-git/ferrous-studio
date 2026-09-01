import { describe, expect, it } from "vitest";
import { applyOps, byPos, OpApplyError, PageLike } from "./applyOps";
import { PageDocument } from "./types";

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

const mainOf = (p: PageLike) => p.document.regions.rm;

describe("applyOps", () => {
  it("sets a nested prop without mutating the input and shares untouched branches", () => {
    const before = page();
    const after = applyOps(before, [
      { op: "set", target: { cmp: "c2" }, path: "props.columns", value: ["Name", "Email"] },
    ]);
    expect(mainOf(after)[0].props).toEqual({ columns: ["Name", "Email"] });
    expect(mainOf(before)[0].props).toEqual({ columns: ["Name"] });
    // Structural sharing: the header region list is the same reference.
    expect(after.document.regions.rh).toBe(before.document.regions.rh);
  });

  it("sets page fields and rejects unknown ones", () => {
    const after = applyOps(page(), [{ op: "set", path: "name", value: "People" }]);
    expect(after.name).toBe("People");
    expect(() => applyOps(page(), [{ op: "set", path: "document", value: {} }])).toThrow(OpApplyError);
    expect(() => applyOps(page(), [{ op: "set", target: { cmp: "c2" }, path: "id", value: "x" }])).toThrow(OpApplyError);
  });

  it("replaces the layout tree via set root, keeping component lists", () => {
    const after = applyOps(page(), [
      { op: "set", path: "root", value: { kind: "region", id: "rm", size: { fr: 1 } } },
    ]);
    expect(after.document.root).toEqual({ kind: "region", id: "rm", size: { fr: 1 } });
    // Lists survive (orphans are pruned on the next normalise, not here).
    expect(after.document.regions.rh).toHaveLength(1);
  });

  it("inserts, removes and moves components between regions", () => {
    let p = applyOps(page(), [
      { op: "insert", into: { region: "rm" }, value: { id: "c9", type: "form", label: "F", pos: "a2" } },
    ]);
    expect(mainOf(p).map((c) => c.id)).toEqual(["c2", "c3", "c9"]);

    p = applyOps(p, [{ op: "move", target: { cmp: "c3" }, to: { region: "rs", pos: "Zz" } }]);
    expect(mainOf(p).map((c) => c.id)).toEqual(["c2", "c9"]);
    expect(p.document.regions.rs[0]).toMatchObject({ id: "c3", pos: "Zz" });

    p = applyOps(p, [{ op: "remove", target: { cmp: "c2" } }]);
    expect(mainOf(p).map((c) => c.id)).toEqual(["c9"]);

    expect(() => applyOps(p, [{ op: "insert", into: { region: "rm" }, value: { id: "c9" } }])).toThrow(/duplicate/);
    expect(() => applyOps(p, [{ op: "insert", into: { region: "nowhere" }, value: { id: "cX" } }])).toThrow(/tree/);
  });
});

describe("byPos", () => {
  it("orders by fractional index, not array position", () => {
    expect(byPos([{ id: 2, pos: "a1" }, { id: 1, pos: "a0" }, { id: 3, pos: "a1V" }]).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});
