import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { CustomDef, Slot } from "../model/actions";
import {
  addSlot,
  deleteSelected,
  groupSelected,
  isContiguousSelection,
  isGroup,
  moveSelected,
  performDrop,
  ungroupSelected,
} from "./builderModel";

function def(): CustomDef {
  return {
    id: "d1",
    name: "Card",
    slots: [
      { id: "a", type: "heading", label: "Title" },
      { id: "b", type: "text", label: "" },
      { id: "c", type: "button", label: "Go" },
    ],
  };
}

const ids = (slots: Slot[]): string[] => slots.map((s) => s.id);

describe("builderModel", () => {
  it("groups contiguous siblings and ungroups them back", () => {
    let d = def();
    let gid = "";
    d = produce(d, (draft) => {
      gid = groupSelected(draft, ["a", "b"], "row")!;
    });
    expect(ids(d.slots)).toEqual([gid, "c"]);
    const g = d.slots[0];
    expect(isGroup(g) ? ids(g.children) : null).toEqual(["a", "b"]);

    d = produce(d, (draft) => {
      ungroupSelected(draft, [gid]);
    });
    expect(ids(d.slots)).toEqual(["a", "b", "c"]);
  });

  it("refuses to group non-contiguous or cross-parent selections", () => {
    const d = def();
    expect(isContiguousSelection(d, ["a", "c"])).toBe(false);
    expect(produce(d, (draft) => void groupSelected(draft, ["a", "c"], "col"))).toEqual(d);
  });

  it("adds into the selected group, else the root", () => {
    let d = produce(def(), (draft) => void groupSelected(draft, ["a", "b"], "col"));
    const gid = d.slots[0].id;
    d = produce(d, (draft) => void addSlot(draft, [gid], "badge"));
    const g = d.slots[0];
    expect(isGroup(g) ? g.children.length : -1).toBe(3);
    d = produce(d, (draft) => void addSlot(draft, [], "badge"));
    expect(d.slots.length).toBe(3);
  });

  it("moves, deletes and drops with index correction", () => {
    let d = produce(def(), (draft) => void moveSelected(draft, ["c"], "up"));
    expect(ids(d.slots)).toEqual(["a", "c", "b"]);

    d = produce(d, (draft) => void performDrop(draft, { kind: "node", id: "a" }, { kind: "after", id: "b" }));
    expect(ids(d.slots)).toEqual(["c", "b", "a"]);

    d = produce(d, (draft) => void performDrop(draft, { kind: "palette", type: "input" }, { kind: "before", id: "c" }));
    expect(d.slots[0].type).toBe("input");

    d = produce(d, (draft) => deleteSelected(draft, ["b", "a"]));
    expect(ids(d.slots).length).toBe(2);
  });

  it("never drops a group into itself", () => {
    let d = produce(def(), (draft) => void groupSelected(draft, ["a", "b"], "col"));
    const gid = d.slots[0].id;
    const before = d;
    d = produce(d, (draft) => void performDrop(draft, { kind: "node", id: gid }, { kind: "into", groupId: gid }));
    expect(d).toEqual(before);
  });
});
