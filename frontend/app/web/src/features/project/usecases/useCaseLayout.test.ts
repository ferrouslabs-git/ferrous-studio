import { describe, expect, it } from "vitest";
import { actorFigureHeight, layoutUseCaseDiagram, MAX_COLUMNS, wrapLabel } from "./useCaseLayout";

const actors = [
  { id: "a1", name: "Customer" },
  { id: "a2", name: "Admin" },
];
const useCases = [
  { id: "u1", name: "Place order", actor_ids: ["a1"] },
  { id: "u2", name: "Refund order", actor_ids: ["a1", "a2"] },
  { id: "u3", name: "Manage catalogue", actor_ids: ["a2", "ghost"] },
];

const manyCases = (n: number, who: string[] = [], prefix = "u") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `Case ${i}`, actor_ids: who }));
const manyActors = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `Actor ${i}` }));

const inside = (layout: ReturnType<typeof layoutUseCaseDiagram>) => {
  for (const u of layout.useCases) {
    expect(u.x - u.rx).toBeGreaterThanOrEqual(layout.boundary.x);
    expect(u.x + u.rx).toBeLessThanOrEqual(layout.boundary.x + layout.boundary.width);
    expect(u.y + u.ry).toBeLessThanOrEqual(layout.boundary.y + layout.boundary.height);
  }
  for (const a of layout.actors) {
    expect(a.y - 10).toBeGreaterThanOrEqual(0);
    expect(a.y + actorFigureHeight(a.labelLines.length)).toBeLessThanOrEqual(layout.height);
    expect(a.x).toBeGreaterThan(0);
    expect(a.x).toBeLessThan(layout.width);
  }
};

describe("wrapLabel", () => {
  it("wraps on words within the limit and keeps long words whole", () => {
    expect(wrapLabel("Accounts payable clerk")).toEqual(["Accounts payable", "clerk"]);
    expect(wrapLabel("System administrator")).toEqual(["System", "administrator"]);
    expect(wrapLabel("Approver")).toEqual(["Approver"]);
    expect(wrapLabel("Supercalifragilisticexpialidocious")).toEqual(["Supercalifragilisticexpialidocious"]);
    expect(wrapLabel("   ")).toEqual([""]);
  });
});

describe("layoutUseCaseDiagram", () => {
  it("records one link per known actor on each use case", () => {
    const layout = layoutUseCaseDiagram(actors, useCases);
    expect(layout.links).toHaveLength(4); // "ghost" is skipped
    expect(layout.links.filter((l) => l.actorId === "a1")).toHaveLength(2);
  });

  it("returns actors in the order given, each on a side, with wrapped labels", () => {
    const layout = layoutUseCaseDiagram([{ id: "x", name: "Accounts payable clerk" }, ...actors], useCases);
    expect(layout.actors.map((a) => a.id)).toEqual(["x", "a1", "a2"]);
    expect(layout.actors[0].labelLines).toEqual(["Accounts payable", "clerk"]);
    expect(new Set(layout.actors.map((a) => a.side)).size).toBe(2);
  });

  it("picks the column count from the width, up to five", () => {
    expect(layoutUseCaseDiagram(actors, manyCases(20), { width: 400 }).columns).toBe(1);
    expect(layoutUseCaseDiagram(actors, manyCases(20), { width: 680 }).columns).toBe(2);
    expect(layoutUseCaseDiagram(actors, manyCases(20), { width: 900 }).columns).toBe(3);
    expect(layoutUseCaseDiagram(actors, manyCases(20), { width: 2400 }).columns).toBe(MAX_COLUMNS);
    // Never more columns than use cases.
    expect(layoutUseCaseDiagram(actors, useCases, { width: 2400 }).columns).toBe(3);
  });

  it("honours a forced column count within bounds", () => {
    expect(layoutUseCaseDiagram(actors, manyCases(20), { width: 400, columns: 4 }).columns).toBe(4);
    expect(layoutUseCaseDiagram(actors, manyCases(20), { width: 2400, columns: 2 }).columns).toBe(2);
    expect(layoutUseCaseDiagram(actors, manyCases(20), { columns: 99 }).columns).toBe(MAX_COLUMNS);
    expect(layoutUseCaseDiagram(actors, manyCases(20), { columns: 0 }).columns).toBeGreaterThan(0);
    expect(layoutUseCaseDiagram(actors, useCases, { columns: 5 }).columns).toBe(3);
  });

  it("uses the width: more columns means a shorter diagram", () => {
    const narrow = layoutUseCaseDiagram(actors, manyCases(24), { width: 600 });
    const wide = layoutUseCaseDiagram(actors, manyCases(24), { width: 1400 });
    expect(wide.height).toBeLessThan(narrow.height);
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it("keeps every element inside the canvas at any size", () => {
    for (const na of [0, 1, 2, 5, 9]) {
      for (const nc of [0, 1, 7, 52]) {
        for (const width of [400, 900, 1600]) {
          inside(layoutUseCaseDiagram(manyActors(na), manyCases(nc, ["a0", "a3"]), { width }));
        }
      }
    }
  });

  it("gives each user type its own band of rows, filled from its side", () => {
    const a = manyActors(2);
    const cases = [...manyCases(5, ["a0"], "p"), ...manyCases(3, ["a1"], "q")];
    const layout = layoutUseCaseDiagram(a, cases, { width: 1200, columns: 4 });
    const y = (id: string) => layout.useCases.find((u) => u.id === id)!.y;
    const x = (id: string) => layout.useCases.find((u) => u.id === id)!.x;
    // a0's five cases fill rows 0–1; a1's start on a fresh row 2.
    expect(y("p4")).toBeGreaterThan(y("p0"));
    expect(y("q0")).toBeGreaterThan(y("p4"));
    expect(new Set(["q0", "q1", "q2"].map(y)).size).toBe(1);
    // A right-side band fills from the right column.
    const a1 = layout.actors.find((p) => p.id === "a1")!;
    const rightmost = Math.max(...layout.useCases.map((u) => u.x));
    const leftmost = Math.min(...layout.useCases.map((u) => u.x));
    expect(x("q0")).toBe(a1.side === "right" ? rightmost : leftmost);
    // Each actor sits within its own band vertically.
    const a0 = layout.actors.find((p) => p.id === "a0")!;
    expect(a0.y).toBeLessThan(y("q0"));
    expect(a1.y + 20).toBeGreaterThan(y("p4"));
  });

  it("sorts shared use cases towards the neighbouring band", () => {
    const a = manyActors(3);
    const cases = [
      { id: "own1", name: "Own", actor_ids: ["a1"] },
      { id: "withNext", name: "Shared with a2", actor_ids: ["a1", "a2"] },
      { id: "withPrev", name: "Shared with a0", actor_ids: ["a1", "a0"] },
      { id: "own2", name: "Own", actor_ids: ["a1"] },
      ...manyCases(3, ["a0"], "z"),
      ...manyCases(3, ["a2"], "w"),
    ];
    const layout = layoutUseCaseDiagram(a, cases, { width: 1200, columns: 1, seed: 0 });
    const order = layout.useCases.map((u) => u.id).filter((id) => ["own1", "withNext", "withPrev", "own2"].includes(id));
    // Within a1's band the one shared with the earlier actor comes first and
    // the one shared with the later actor comes last.
    expect(order[0]).toBe("withPrev");
    expect(order[order.length - 1]).toBe("withNext");
  });

  it("rearranges with the seed and never overlaps actors on a side", () => {
    const a = manyActors(6);
    const cases = manyCases(12, ["a0", "a1", "a2", "a3", "a4", "a5"]);
    const first = layoutUseCaseDiagram(a, cases, { width: 1200, seed: 0 });
    const second = layoutUseCaseDiagram(a, cases, { width: 1200, seed: 1 });
    expect(second.actors.map((x) => [x.side, x.y])).not.toEqual(first.actors.map((x) => [x.side, x.y]));
    for (const layout of [first, second]) {
      for (const side of ["left", "right"] as const) {
        const group = layout.actors.filter((x) => x.side === side).sort((p, q) => p.y - q.y);
        for (let i = 1; i < group.length; i++) {
          expect(group[i].y).toBeGreaterThanOrEqual(group[i - 1].y + actorFigureHeight(group[i - 1].labelLines.length));
        }
      }
      inside(layout);
    }
  });
});
