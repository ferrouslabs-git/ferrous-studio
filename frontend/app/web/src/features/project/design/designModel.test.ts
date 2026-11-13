// What the design pages say about a design is derived here, so it is checked
// here: the status badge, which revision is on show, and what may become a
// link out to Figma.
import { describe, expect, it } from "vitest";
import { DesignRevision, designState, figmaHref, revisionLabel, shownRevision } from "./designModel";

const revision = (over: Partial<DesignRevision>): DesignRevision => ({
  id: "r1",
  design_id: "d1",
  revision_no: 1,
  origin: "claude_code",
  summary: null,
  source_hash: "a".repeat(64),
  html_bytes: 1024,
  source_bytes: 2048,
  status: "uploaded",
  created_at: "2026-11-13T14:05:00",
  ...over,
});

describe("designState", () => {
  it("is not generated until a revision is on show", () => {
    expect(designState({ current_revision_id: null })).toBe("not_generated");
    expect(designState({ current_revision_id: "r1" })).toBe("synced");
  });
});

describe("shownRevision", () => {
  // Newest first, as the API returns them.
  const revisions = [revision({ id: "r3", revision_no: 3 }), revision({ id: "r2", revision_no: 2 }), revision({ id: "r1" })];

  it("follows the current revision when none is picked", () => {
    expect(shownRevision(revisions, null, "r3")?.id).toBe("r3");
  });
  it("keeps showing a picked revision when a newer one arrives", () => {
    expect(shownRevision(revisions, "r1", "r3")?.id).toBe("r1");
  });
  it("falls back to the current one when the picked revision is gone", () => {
    expect(shownRevision(revisions, "gone", "r2")?.id).toBe("r2");
  });
  it("falls back to the newest when the current one is not in the list", () => {
    expect(shownRevision(revisions, null, "elsewhere")?.id).toBe("r3");
  });
  it("is null for a design with no revisions", () => {
    expect(shownRevision([], null, null)).toBeNull();
  });
});

describe("revisionLabel", () => {
  it("names the number, when, and where it came from", () => {
    const label = revisionLabel(revision({ revision_no: 2, origin: "figma_make" }), null);
    expect(label).toContain("Revision 2");
    expect(label).toContain("13 Nov 2026");
    expect(label).toContain("Figma Make");
    expect(label).not.toContain("Current");
  });
  it("marks the revision on show", () => {
    expect(revisionLabel(revision({}), "r1")).toMatch(/Claude Code · Current$/);
  });
});

describe("figmaHref", () => {
  it("accepts Figma's own https addresses", () => {
    expect(figmaHref("https://www.figma.com/make/AbC/Checkout")).toBe("https://www.figma.com/make/AbC/Checkout");
    expect(figmaHref("https://checkout.figma.site/")).toBe("https://checkout.figma.site/");
  });
  it("refuses anything else, so no other link is ever built from a stored value", () => {
    for (const url of [
      null,
      "",
      "not a url",
      "http://www.figma.com/make/AbC",
      "javascript:alert(1)",
      "https://figma.com.evil.example/make/AbC",
      "https://evilfigma.com/make/AbC",
    ]) {
      expect(figmaHref(url)).toBeNull();
    }
  });
});
