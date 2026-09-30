// @vitest-environment jsdom
//
// jsdom has no layout, so matchMedia is stubbed with a list whose answer the
// test controls; what is under test is the hook's subscription, not CSS.
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PHONE_QUERY, useIsPhone, useMediaQuery } from "./breakpoints";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

class FakeList {
  matches = false;
  private listeners = new Set<() => void>();
  constructor(readonly media: string) {}
  addEventListener(_: "change", fn: () => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_: "change", fn: () => void) {
    this.listeners.delete(fn);
  }
  set(matches: boolean) {
    this.matches = matches;
    this.listeners.forEach((fn) => fn());
  }
  get listening() {
    return this.listeners.size;
  }
}

let lists: Map<string, FakeList>;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  lists = new Map();
  window.matchMedia = ((q: string) => {
    if (!lists.has(q)) lists.set(q, new FakeList(q));
    return lists.get(q)!;
  }) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Probe({ query }: { query: string }) {
  return <span>{useMediaQuery(query) ? "yes" : "no"}</span>;
}

describe("useMediaQuery", () => {
  it("reads the query's current answer", () => {
    window.matchMedia("(max-width: 1px)");
    lists.get("(max-width: 1px)")!.matches = true;
    act(() => root.render(<Probe query="(max-width: 1px)" />));
    expect(host.textContent).toBe("yes");
  });

  it("re-renders when the answer changes, and stops listening on unmount", () => {
    act(() => root.render(<Probe query="(hover: none)" />));
    expect(host.textContent).toBe("no");
    const list = lists.get("(hover: none)")!;
    act(() => list.set(true));
    expect(host.textContent).toBe("yes");
    act(() => root.render(<span />));
    expect(list.listening).toBe(0);
  });

  it("useIsPhone asks the phone band", () => {
    function Phone() {
      return <span>{useIsPhone() ? "phone" : "wider"}</span>;
    }
    act(() => root.render(<Phone />));
    expect(host.textContent).toBe("wider");
    act(() => lists.get(PHONE_QUERY)!.set(true));
    expect(host.textContent).toBe("phone");
  });

  it("is false when rendered on the server", () => {
    // The prerendered landing page has no window to ask.
    expect(renderToString(<Probe query="(max-width: 99999px)" />)).toContain("no");
  });
});
