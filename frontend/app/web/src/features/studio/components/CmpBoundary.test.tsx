// @vitest-environment jsdom
//
// An error boundary is the one thing in the studio that cannot be checked by
// rendering to a string: React only calls getDerivedStateFromError while
// reconciling into a real tree, and server rendering rethrows instead. So
// this file alone pays for a DOM, the way applyModel.test.ts does for
// maxGraph.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CmpBoundary } from "./CmpBoundary";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;

/** React 18 rethrows a caught error through a synthetic DOM event so dev
 *  tools can still see it; jsdom then prints the whole stack. Cancelling the
 *  event is what keeps a passing run's output readable. */
const swallow = (e: ErrorEvent) => e.preventDefault();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  window.addEventListener("error", swallow);
  // React logs every caught error; the boundary's own console.error is the
  // behaviour under test elsewhere, not here.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener("error", swallow);
  vi.restoreAllMocks();
  host.remove();
});

const Boom = ({ throws }: { throws: boolean }) => {
  if (throws) throw new TypeError("v.split is not a function");
  return <p>drawn</p>;
};

describe("CmpBoundary", () => {
  it("shows a placeholder instead of taking the page down", () => {
    const root = createRoot(host);
    act(() => {
      root.render(
        <div>
          <CmpBoundary cmpId="c-orgs-l" cmpType="list">
            <Boom throws />
          </CmpBoundary>
          <p>the rest of the page</p>
        </div>,
      );
    });

    expect(host.textContent).toContain("This list could not be drawn");
    expect(host.textContent).toContain("v.split is not a function");
    // The point of the boundary: everything around it still rendered.
    expect(host.textContent).toContain("the rest of the page");
  });

  it("redraws the component when Try again is pressed", () => {
    const root = createRoot(host);
    const tree = (throws: boolean) => (
      <CmpBoundary cmpId="c-orgs-l" cmpType="list">
        <Boom throws={throws} />
      </CmpBoundary>
    );

    act(() => root.render(tree(true)));
    expect(host.textContent).toContain("could not be drawn");

    // The document has since been repaired; the retry picks that up.
    act(() => root.render(tree(false)));
    expect(host.textContent).toContain("could not be drawn");
    act(() => host.querySelector("button")!.click());
    expect(host.textContent).toBe("drawn");
  });

  it("clears itself when a different component takes the slot", () => {
    const root = createRoot(host);
    act(() =>
      root.render(
        <CmpBoundary cmpId="c-orgs-l" cmpType="list">
          <Boom throws />
        </CmpBoundary>,
      ),
    );
    expect(host.textContent).toContain("could not be drawn");

    act(() =>
      root.render(
        <CmpBoundary cmpId="c-orgs-h" cmpType="canvas">
          <Boom throws={false} />
        </CmpBoundary>,
      ),
    );
    expect(host.textContent).toBe("drawn");
  });
});
