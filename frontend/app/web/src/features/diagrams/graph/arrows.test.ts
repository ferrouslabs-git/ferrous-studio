import { describe, expect, it } from "vitest";
import { ARROW_KINDS, arrowKindOf, withArrow } from "./arrows";

describe("arrows", () => {
  it("reads default when the style says nothing about that end", () => {
    expect(arrowKindOf({ baseStyleNames: ["uml:generalisation"] }, "end")).toBe("default");
    expect(arrowKindOf(undefined, "start")).toBe("default");
  });

  it("round-trips every kind through the style on either end", () => {
    for (const { kind } of ARROW_KINDS) {
      expect(arrowKindOf(withArrow({}, "start", kind), "start")).toBe(kind);
      expect(arrowKindOf(withArrow({}, "end", kind), "end")).toBe(kind);
    }
  });

  it("clears an end back to default without touching the other end or the type", () => {
    const both = withArrow(withArrow({ baseStyleNames: ["uml:association"], exitX: 1 }, "start", "circle"), "end", "hollow");
    const cleared = withArrow(both, "end", "default");
    expect(cleared).toEqual({ baseStyleNames: ["uml:association"], exitX: 1, startArrow: "oval", startFill: true, startSize: 8 });
  });

  it("tells filled and hollow markers apart", () => {
    expect(arrowKindOf({ endArrow: "diamond", endFill: false }, "end")).toBe("diamondHollow");
    expect(arrowKindOf({ endArrow: "diamond", endFill: true }, "end")).toBe("diamondFilled");
    expect(arrowKindOf({ endArrow: "block" }, "end")).toBe("filled");
  });
});
