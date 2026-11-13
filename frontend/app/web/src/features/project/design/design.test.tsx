// @vitest-environment jsdom
// The frame a revision is shown in is the feature's security boundary: the
// file is generated HTML with its own script, and what keeps it away from
// Studio is the sandbox on this one element. Pinned here so loosening it is a
// decision someone has to make on purpose.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesignStatusBadge } from "./DesignStatusBadge";
import * as api from "./designsApi";
import { PROTOTYPE_SANDBOX, PrototypeFrame } from "./PrototypeFrame";

describe("PrototypeFrame", () => {
  const html = renderToString(<PrototypeFrame url="https://bucket.s3.eu-west-1.amazonaws.com/k?X-Amz-Signature=s" title="Checkout" />);

  it("runs the prototype's script", () => {
    expect(PROTOTYPE_SANDBOX.split(" ")).toContain("allow-scripts");
  });
  it("never gives the prototype Studio's origin", () => {
    // allow-same-origin beside allow-scripts would let the framed document
    // remove its own sandbox; without it the frame's origin is opaque.
    expect(PROTOTYPE_SANDBOX).not.toContain("allow-same-origin");
  });
  it("cannot navigate Studio away, open windows or put up dialogs", () => {
    for (const token of ["allow-top-navigation", "allow-popups", "allow-modals", "allow-downloads"]) {
      expect(PROTOTYPE_SANDBOX).not.toContain(token);
    }
  });
  it("puts the sandbox on the iframe it renders", () => {
    expect(html).toContain(`sandbox="${PROTOTYPE_SANDBOX}"`);
    expect(html).toContain('title="Checkout"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
  it("loads from the URL it is given and not from a blob", () => {
    // A blob: frame would inherit Studio's CSP and its script would not run.
    expect(html).toContain('src="https://bucket.s3.eu-west-1.amazonaws.com/k?X-Amz-Signature=s"');
  });
});

describe("DesignStatusBadge", () => {
  it("reads Not generated before the first revision", () => {
    expect(renderToString(<DesignStatusBadge design={{ current_revision_id: null }} />)).toContain("Not generated");
  });
  it("reads Synced once a revision is on show", () => {
    const html = renderToString(<DesignStatusBadge design={{ current_revision_id: "r1" }} />);
    expect(html).toContain("Synced");
    expect(html).toContain("badge good");
  });
});

describe("designsApi", () => {
  it("has no call that creates, edits or deletes a revision", () => {
    // Studio never edits a design: revisions only arrive from the skill.
    const names = Object.keys(api).filter((name) => /revision/i.test(name) && typeof (api as Record<string, unknown>)[name] === "function");
    expect(names.sort()).toEqual(["getRevisionViewUrl", "listDesignRevisions", "revisionLabel", "shownRevision"]);
  });
});
