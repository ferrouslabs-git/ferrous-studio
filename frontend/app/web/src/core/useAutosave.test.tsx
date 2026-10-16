// @vitest-environment jsdom
//
// The hook is driven through a tiny harness component; fake timers stand in
// for the typing pause, and each save is a promise the test resolves or
// rejects by hand so the in-flight cases can be stepped through.
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosave, AutosaveOptions, FlushResult, useAutosave } from "./useAutosave";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Draft {
  name: string;
  kind: string;
}

const INITIAL: Draft = { name: "Alpha", kind: "a" };

/** A save whose calls are recorded and settled by the test. */
function controlledSave() {
  const calls: { value: Draft; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const save = vi.fn(
    (value: Draft) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
  );
  return { save, calls };
}

let root: Root;
let host: HTMLDivElement;
let auto: Autosave<Draft>;

function Harness(props: { opts: AutosaveOptions<Draft> }) {
  auto = useAutosave<Draft>(INITIAL, props.opts);
  return null;
}

function mount(opts: AutosaveOptions<Draft>) {
  act(() => root.render(<Harness opts={opts} />));
}

/** Let settled promises run their continuations inside act. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutosave", () => {
  it("debounces typing into one save of the latest value", async () => {
    const { save, calls } = controlledSave();
    mount({ save, delay: 700 });

    act(() => auto.set({ name: "Al" }));
    act(() => vi.advanceTimersByTime(300));
    act(() => auto.set({ name: "Alp" }));
    act(() => vi.advanceTimersByTime(300));
    act(() => auto.set({ name: "Alpine" }));
    expect(save).not.toHaveBeenCalled();
    expect(auto.status).toBe("pending");
    expect(auto.dirty).toBe(true);

    act(() => vi.advanceTimersByTime(700));
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0].value).toEqual({ name: "Alpine", kind: "a" });
    expect(auto.status).toBe("saving");

    calls[0].resolve();
    await settle();
    expect(auto.status).toBe("saved");
    expect(auto.dirty).toBe(false);
  });

  it("saves at once for an immediate change (a select or toggle)", async () => {
    const { save, calls } = controlledSave();
    mount({ save });
    act(() => auto.set({ kind: "b" }, { immediate: true }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0].value.kind).toBe("b");
  });

  it("flush saves a pending change straight away and cancels the timer", async () => {
    const { save, calls } = controlledSave();
    mount({ save });
    act(() => auto.set({ name: "Beta" }));
    let result: FlushResult | undefined;
    act(() => {
      void auto.flush().then((r) => (result = r));
    });
    expect(save).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await settle();
    expect(result).toBe("saved");
    act(() => vi.advanceTimersByTime(5000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not save a value that is back to what was saved", () => {
    const { save } = controlledSave();
    mount({ save });
    act(() => auto.set({ name: "Changed" }));
    act(() => auto.set({ name: "Alpha" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(save).not.toHaveBeenCalled();
    expect(auto.dirty).toBe(false);
  });

  it("never sends an invalid value, and exposes its field errors after the pause", async () => {
    const { save, calls } = controlledSave();
    mount({ save, validate: (d) => (d.name.trim() ? null : { name: "Required." }) });

    act(() => auto.set({ name: "" }));
    expect(auto.fieldErrors.name).toBeUndefined();
    act(() => vi.advanceTimersByTime(1000));
    expect(save).not.toHaveBeenCalled();
    expect(auto.status).toBe("invalid");
    expect(auto.fieldErrors.name).toBe("Required.");

    let result: FlushResult | undefined;
    await act(async () => {
      result = await auto.flush();
    });
    expect(result).toBe("invalid");
    expect(save).not.toHaveBeenCalled();

    act(() => auto.set({ name: "Fixed" }));
    expect(auto.fieldErrors.name).toBeUndefined();
    act(() => vi.advanceTimersByTime(1000));
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0].value.name).toBe("Fixed");
  });

  it("surfaces a failed save, and a later flush retries it", async () => {
    const { save, calls } = controlledSave();
    mount({ save });
    act(() => auto.set({ name: "Gamma" }, { immediate: true }));
    calls[0].reject(new Error("Server said no"));
    await settle();
    expect(auto.status).toBe("error");
    expect(auto.error).toBe("Server said no");
    expect(auto.dirty).toBe(true);

    let result: FlushResult | undefined;
    act(() => {
      void auto.flush().then((r) => (result = r));
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1].value.name).toBe("Gamma");
    calls[1].resolve();
    await settle();
    expect(result).toBe("saved");
    expect(auto.status).toBe("saved");
    expect(auto.error).toBeNull();
  });

  it("runs saves one at a time and sends edits made in flight afterwards", async () => {
    const { save, calls } = controlledSave();
    mount({ save });
    act(() => auto.set({ name: "One" }, { immediate: true }));
    act(() => auto.set({ name: "Two" }, { immediate: true }));
    // The second waits for the first rather than racing it.
    expect(save).toHaveBeenCalledTimes(1);

    calls[0].resolve();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1].value.name).toBe("Two");
    calls[1].resolve();
    await settle();
    expect(auto.status).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flushes a pending change when the form unmounts", () => {
    const { save, calls } = controlledSave();
    mount({ save });
    act(() => auto.set({ name: "Leaving" }));
    act(() => root.unmount());
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0].value.name).toBe("Leaving");
    // Re-create a root for afterEach to unmount.
    root = createRoot(host);
  });

  it("says so when a save made on the way out fails", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { save, calls } = controlledSave();
    mount({ save });
    act(() => auto.set({ name: "Leaving" }));
    act(() => root.unmount());
    calls[0].reject(new Error("Offline"));
    await settle();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("Offline"));
    root = createRoot(host);
  });

  it("saves nothing while disabled (a create form)", () => {
    const { save } = controlledSave();
    mount({ save, enabled: false });
    act(() => auto.set({ name: "Draft" }));
    act(() => vi.advanceTimersByTime(5000));
    act(() => root.unmount());
    expect(save).not.toHaveBeenCalled();
    root = createRoot(host);
  });

  it("with no delay, waits for flush", async () => {
    const { save } = controlledSave();
    mount({ save, delay: null });
    act(() => auto.set({ name: "KEY" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(save).not.toHaveBeenCalled();
    act(() => {
      void auto.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reset adopts a new baseline without saving", () => {
    const { save } = controlledSave();
    mount({ save });
    act(() => auto.set({ name: "Typed" }));
    act(() => auto.reset({ name: "Other", kind: "z" }));
    act(() => vi.advanceTimersByTime(5000));
    expect(save).not.toHaveBeenCalled();
    expect(auto.value).toEqual({ name: "Other", kind: "z" });
    expect(auto.dirty).toBe(false);
    expect(auto.status).toBe("idle");
  });
});
