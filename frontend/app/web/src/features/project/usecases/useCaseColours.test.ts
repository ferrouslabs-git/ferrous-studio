import { describe, expect, it } from "vitest";
import { actorColour, actorColours, gradientAt, withAlpha } from "./useCaseColours";

describe("use case colours", () => {
  it("runs from brand orange to brand blue", () => {
    expect(gradientAt(0)).toBe("rgb(255, 91, 26)");
    expect(gradientAt(0.5)).toBe("rgb(124, 92, 255)");
    expect(gradientAt(1)).toBe("rgb(37, 64, 232)");
    expect(gradientAt(-1)).toBe(gradientAt(0));
    expect(gradientAt(2)).toBe(gradientAt(1));
  });

  it("spaces user types evenly and keeps the ends on the brand colours", () => {
    expect(actorColour(0, 1)).toBe("rgb(255, 91, 26)");
    expect(actorColour(0, 5)).toBe("rgb(255, 91, 26)");
    expect(actorColour(4, 5)).toBe("rgb(37, 64, 232)");
    expect(actorColour(2, 5)).toBe("rgb(124, 92, 255)");
    const five = new Set(Array.from({ length: 5 }, (_, i) => actorColour(i, 5)));
    expect(five.size).toBe(5);
  });

  it("maps ids in order and adds alpha", () => {
    const m = actorColours(["a", "b"]);
    expect(m.get("a")).toBe("rgb(255, 91, 26)");
    expect(m.get("b")).toBe("rgb(37, 64, 232)");
    expect(withAlpha("rgb(1, 2, 3)", 0.2)).toBe("rgba(1, 2, 3, 0.2)");
  });
});
