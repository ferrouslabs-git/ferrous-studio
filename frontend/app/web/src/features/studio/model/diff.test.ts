import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { applyOps } from "./applyOps";
import { diffPage } from "./diff";
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

/** Round-trip property: applying the diff to `prev` must reproduce `next`. */
function roundTrip(prev: ReturnType<typeof page>, next: ReturnType<typeof page>) {
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
      const f = d.document.frames[0];
      if (f.layoutMode === "regions") f.layout.regions.main[0].props = { columns: ["Name", "Email"] };
    });
    const ops = roundTrip(prev, next);
    expect(ops).toEqual([{ op: "set", target: { frame: "f1", cmp: "c2" }, path: "props", value: { columns: ["Name", "Email"] } }]);
  });

  it("detects inserts, removes and moves between regions", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      const f = d.document.frames[0];
      if (f.layoutMode !== "regions") return;
      const [c3] = f.layout.regions.main.splice(1, 1);
      c3.pos = "a0";
      f.layout.regions.right.push(c3);
      f.layout.regions.header.splice(0, 1);
      f.layout.regions.footer.push({ id: "c9", type: "footer", label: "Footer", pos: "a0" });
    });
    const ops = roundTrip(prev, next);
    expect(ops).toContainEqual({ op: "remove", target: { frame: "f1", cmp: "c1" } });
    expect(ops).toContainEqual({ op: "move", target: { frame: "f1", cmp: "c3" }, to: { region: "right", pos: "a0" } });
    expect(ops).toContainEqual({ op: "insert", target: { frame: "f1" }, into: { region: "footer" }, value: { id: "c9", type: "footer", label: "Footer", pos: "a0" } });
  });

  it("reorders within a region as a pos-only move", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      const f = d.document.frames[0];
      if (f.layoutMode === "regions") f.layout.regions.main[1].pos = "Zz";
    });
    expect(roundTrip(prev, next)).toEqual([{ op: "move", target: { frame: "f1", cmp: "c3" }, to: { pos: "Zz" } }]);
  });

  it("replaces the whole layout when the layout mode changes", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      d.document.frames[0] = { id: "f1", label: "Default", pos: "a0", layoutMode: "flat", layout: { components: [] } };
    });
    const ops = roundTrip(prev, next);
    expect(ops.map((o) => o.op)).toEqual(["set", "set"]);
  });

  it("handles frames and page fields", () => {
    const prev = page();
    const next = produce(prev, (d) => {
      d.name = "People";
      d.document.frames[0].label = "Desktop";
      d.document.frames.push({ id: "f2", label: "Mobile", pos: "a1", layoutMode: "flat", layout: { components: [] } });
    });
    const ops = roundTrip(prev, next);
    expect(ops).toContainEqual({ op: "set", path: "name", value: "People" });
    expect(ops).toContainEqual({ op: "set", target: { frame: "f1" }, path: "label", value: "Desktop" });
    expect(ops.some((o) => o.op === "insert" && o.into.list === "frames")).toBe(true);

    const back = roundTrip(next, prev); // undo direction
    expect(back).toContainEqual({ op: "remove", target: { frame: "f2" } });
  });
});
