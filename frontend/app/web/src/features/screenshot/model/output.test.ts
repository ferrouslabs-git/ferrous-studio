import { describe, expect, it } from "vitest";
import { captureScale, encodingLadder, extensionFor, formatSize, OUTPUT_MAX_EDGE, scaledSize } from "./output";

describe("captureScale", () => {
  it("brings a 4K capture down to the cap", () => {
    expect(captureScale(3840, 2160, OUTPUT_MAX_EDGE)).toBeCloseTo(2560 / 3840);
  });

  it("leaves anything already within it alone", () => {
    expect(captureScale(1280, 800, OUTPUT_MAX_EDGE)).toBe(1);
  });

  it("never enlarges a small capture", () => {
    expect(captureScale(200, 100, OUTPUT_MAX_EDGE)).toBe(1);
  });

  it("measures the longest edge, whichever way round the image is", () => {
    expect(captureScale(1000, 4000, 2000)).toBe(0.5);
  });

  it("survives a zero-sized image rather than returning Infinity", () => {
    expect(captureScale(0, 0, OUTPUT_MAX_EDGE)).toBe(1);
  });
});

describe("scaledSize", () => {
  it("keeps the aspect ratio in whole pixels", () => {
    expect(scaledSize({ width: 3840, height: 2160 }, 2560)).toEqual({ width: 2560, height: 1440 });
  });

  it("never rounds a dimension down to nothing", () => {
    expect(scaledSize({ width: 4000, height: 1 }, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe("encodingLadder", () => {
  const ladder = encodingLadder({ width: 2560, height: 1440 });

  it("tries PNG first -- screenshots are flat colour and text", () => {
    expect(ladder[0].type).toBe("image/png");
  });

  it("falls back through JPEG at decreasing quality", () => {
    const jpegs = ladder.filter((e) => e.type === "image/jpeg");
    expect(jpegs.length).toBeGreaterThan(1);
    expect(jpegs[0].quality).toBeGreaterThan(jpegs[1].quality);
  });

  it("gives up on resolution only as a last resort", () => {
    expect(ladder.slice(0, -1).every((e) => e.maxEdge === OUTPUT_MAX_EDGE)).toBe(true);
    expect(ladder[ladder.length - 1].maxEdge).toBeLessThan(OUTPUT_MAX_EDGE);
  });

  it("never shrinks a small image below a legible floor", () => {
    const small = encodingLadder({ width: 300, height: 200 });
    expect(small[small.length - 1].maxEdge).toBe(640);
  });
});

describe("formatSize", () => {
  it("reads naturally at each magnitude", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(1_500_000)).toBe("1.4 MB");
  });
});

describe("extensionFor", () => {
  it("names the file the way the server's allow-list expects", () => {
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});
