// @vitest-environment jsdom
// The frame a design is shown in is the feature's security boundary: it loads
// a site Studio does not control, and what keeps it away from Studio is the
// sandbox on this one element plus the CSP's frame-src. Pinned here so
// loosening it is a decision someone has to make on purpose.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesignStatusBadge } from "./DesignStatusBadge";
import * as api from "./designsApi";
import { PROTOTYPE_SANDBOX, PrototypeFrame } from "./PrototypeFrame";

describe("PrototypeFrame", () => {
  const html = renderToString(<PrototypeFrame url="https://checkout-demo.figma.site/?studio_sync=1" title="Checkout" />);

  it("runs the site's script on its own origin", () => {
    // Safe only because the site is on figma.site, never Studio's origin:
    // a cross-origin frame cannot reach this element to lift its sandbox.
    expect(PROTOTYPE_SANDBOX.split(" ")).toEqual(expect.arrayContaining(["allow-scripts", "allow-same-origin"]));
  });
  it("cannot navigate Studio away, open windows, put up dialogs or download", () => {
    for (const token of ["allow-top-navigation", "allow-popups", "allow-modals", "allow-downloads"]) {
      expect(PROTOTYPE_SANDBOX).not.toContain(token);
    }
  });
  it("puts the sandbox on the iframe it renders", () => {
    expect(html).toContain(`sandbox="${PROTOTYPE_SANDBOX}"`);
    expect(html).toContain('title="Checkout"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
  it("loads the published site it is given", () => {
    expect(html).toContain('src="https://checkout-demo.figma.site/?studio_sync=1"');
  });
});

describe("DesignStatusBadge", () => {
  const badge = (figma_url: string | null, published_url: string | null) =>
    renderToString(<DesignStatusBadge design={{ figma_url, published_url }} />);

  it("reads Not generated before there is a Make file", () => {
    expect(badge(null, null)).toContain("Not generated");
  });
  it("reads In Figma once the Make file exists", () => {
    expect(badge("https://www.figma.com/make/AbC", null)).toContain("In Figma");
  });
  it("reads Published once there is a site to show", () => {
    const html = badge("https://www.figma.com/make/AbC", "https://checkout.figma.site");
    expect(html).toContain("Published");
    expect(html).toContain("badge good");
  });
});

describe("designsApi", () => {
  it("has no call that changes a design's content", () => {
    // Studio never edits a design: it files the brief and frames the site.
    const calls = Object.keys(api).filter(
      (name) => typeof (api as Record<string, unknown>)[name] === "function" && /^(create|update|delete)/.test(name),
    );
    expect(calls.sort()).toEqual(["createDesign", "deleteDesign", "updateDesign"]);
    expect(Object.keys(api).some((name) => /revision/i.test(name))).toBe(false);
  });
});
