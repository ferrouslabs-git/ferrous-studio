import { describe, expect, it } from "vitest";
import { applyOps, byPos, OpApplyError } from "./applyOps";
import { PageDocument } from "./types";

function page() {
  const document: PageDocument = {
    frames: [
      {
        id: "f1",
        label: "Default",
        pos: "a0",
        layoutMode: "regions",
        layout: {
          regions: {
            header: [{ id: "c1", type: "navbar", label: "App", pos: "a0" }],
            sidebar: [],
            main: [
              { id: "c2", type: "list", label: "Directory", pos: "a0", props: { columns: ["Name"] } },
              { id: "c3", type: "kpi", label: "Stats", pos: "a1" },
            ],
            right: [],
            footer: [],
          },
          options: { smartDock: true, mainFlow: "stack" },
        },
      },
    ],
  };
  return { name: "Users", route: "/users", pos: "a0", document };
}

function mainOf(p: ReturnType<typeof page>) {
  const f = p.document.frames[0];
  return f.layoutMode === "regions" ? f.layout.regions.main : [];
}

describe("applyOps", () => {
  it("sets a nested prop without mutating the input and shares untouched branches", () => {
    const before = page();
    const after = applyOps(before, [
      { op: "set", target: { frame: "f1", cmp: "c2" }, path: "props.columns", value: ["Name", "Email"] },
    ]);
    expect(mainOf(after)[0].props).toEqual({ columns: ["Name", "Email"] });
    expect(mainOf(before)[0].props).toEqual({ columns: ["Name"] });
    // Structural sharing: the header region is the same reference.
    const fb = before.document.frames[0];
    const fa = after.document.frames[0];
    if (fb.layoutMode === "regions" && fa.layoutMode === "regions") {
      expect(fa.layout.regions.header).toBe(fb.layout.regions.header);
    }
  });

  it("sets page fields and rejects unknown ones", () => {
    const after = applyOps(page(), [{ op: "set", path: "name", value: "People" }]);
    expect(after.name).toBe("People");
    expect(() => applyOps(page(), [{ op: "set", path: "document", value: {} }])).toThrow(OpApplyError);
    expect(() => applyOps(page(), [{ op: "set", target: { frame: "f1", cmp: "c2" }, path: "id", value: "x" }])).toThrow(OpApplyError);
  });

  it("inserts, removes and moves components", () => {
    let p = applyOps(page(), [
      { op: "insert", target: { frame: "f1" }, into: { region: "main" }, value: { id: "c9", type: "form", label: "F", pos: "a2" } },
    ]);
    expect(mainOf(p).map((c) => c.id)).toEqual(["c2", "c3", "c9"]);

    p = applyOps(p, [{ op: "move", target: { frame: "f1", cmp: "c3" }, to: { region: "right", pos: "Zz" } }]);
    expect(mainOf(p).map((c) => c.id)).toEqual(["c2", "c9"]);
    const f = p.document.frames[0];
    if (f.layoutMode === "regions") expect(f.layout.regions.right[0]).toMatchObject({ id: "c3", pos: "Zz" });

    p = applyOps(p, [{ op: "remove", target: { frame: "f1", cmp: "c2" } }]);
    expect(mainOf(p).map((c) => c.id)).toEqual(["c9"]);

    expect(() => applyOps(p, [{ op: "insert", target: { frame: "f1" }, into: { region: "main" }, value: { id: "c9" } }])).toThrow(/duplicate/);
  });

  it("inserts and removes frames", () => {
    let p = applyOps(page(), [
      { op: "insert", into: { list: "frames" }, value: { id: "f2", label: "Mobile", pos: "a1", layoutMode: "flat", layout: { components: [] } } },
    ]);
    expect(p.document.frames.map((f) => f.id)).toEqual(["f1", "f2"]);
    p = applyOps(p, [{ op: "remove", target: { frame: "f1" } }]);
    expect(p.document.frames.map((f) => f.id)).toEqual(["f2"]);
  });
});

describe("byPos", () => {
  it("orders by fractional index, not array position", () => {
    expect(byPos([{ id: 2, pos: "a1" }, { id: 1, pos: "a0" }, { id: 3, pos: "a1V" }]).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});
