// Save-as-you-go for forms that edit something which already exists. The hook
// owns the form's value: typing schedules a save after a short pause, a
// select or toggle (`set(..., { immediate: true })`) and leaving a field
// (`flush()`) save straight away, and unmounting flushes whatever is still
// pending. Creating a thing is different -- that keeps its explicit button --
// so `enabled: false` turns the saving off and leaves just the form state.
//
// Saves run one at a time, always with the latest value: edits made while a
// save is in flight are sent once it lands. A value that fails `validate` is
// never sent; its field errors are exposed for the form to show. A failed
// save is never swallowed: it sets `error` and the status, and a later edit or
// flush tries again.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "invalid" | "error";

export type FlushResult = "saved" | "invalid" | "error";

export type FieldErrors<T> = Partial<Record<keyof T & string, string>>;

export interface AutosaveOptions<T> {
  /** Persist the value. Read through a ref, so an inline closure is fine. */
  save: (value: T) => Promise<unknown>;
  /** Field errors for a value that must not be sent; null or {} when valid. */
  validate?: (value: T) => FieldErrors<T> | null;
  /** Pause after typing before a save, in ms; null saves only on flush. */
  delay?: number | null;
  /** False keeps the form state but never saves (a create form). */
  enabled?: boolean;
  equals?: (a: T, b: T) => boolean;
}

export interface Autosave<T> {
  value: T;
  /** Change the value; `immediate` saves now rather than after the pause. */
  set: (patch: Partial<T> | ((value: T) => T), opts?: { immediate?: boolean }) => void;
  /**
   * Save anything pending now. "saved" once nothing is left unsaved,
   * "invalid" when the value fails validation (and was not sent), "error"
   * when the save failed.
   */
  flush: () => Promise<FlushResult>;
  /** Start over from `value`, as already saved. Discards anything pending. */
  reset: (value: T) => void;
  status: AutosaveStatus;
  /** The last save's failure, if it failed. */
  error: string | null;
  /** Why the current value is not being saved, per field. */
  fieldErrors: FieldErrors<T>;
  dirty: boolean;
}

export const AUTOSAVE_DELAY = 700;

const jsonEquals = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const hasErrors = (errs: FieldErrors<unknown> | null | undefined): boolean =>
  !!errs && Object.values(errs).some(Boolean);

export function useAutosave<T>(initial: T, opts: AutosaveOptions<T>): Autosave<T> {
  const [value, setValue] = useState<T>(initial);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // `saved` is the value last known to be on the server; `dirty` is derived
  // from it on render, so it only needs to be state for that re-render.
  const [saved, setSaved] = useState<T>(initial);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const valueRef = useRef(value);
  const savedRef = useRef(saved);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);
  // Bumped by reset(), so a save that lands for an abandoned value does not
  // overwrite the new baseline.
  const epochRef = useRef(0);

  const equals = (a: T, b: T) => (optsRef.current.equals ?? jsonEquals)(a, b);
  const enabled = () => optsRef.current.enabled !== false;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const update = (s: AutosaveStatus, err: string | null = null) => {
    if (!mountedRef.current) return;
    setStatus(s);
    setError(err);
  };

  const flush = useCallback(async (): Promise<FlushResult> => {
    clearTimer();
    for (;;) {
      const inflight = inflightRef.current;
      if (inflight) {
        // Another caller is saving. If it fails, this one reports the same
        // failure rather than firing the identical request again.
        if (!(await inflight)) return "error";
        continue;
      }
      const v = valueRef.current;
      if (!enabled() || equals(v, savedRef.current)) {
        if (mountedRef.current) {
          setStatus((s) => (s === "idle" ? s : "saved"));
          setError(null);
        }
        return "saved";
      }
      if (hasErrors(optsRef.current.validate?.(v))) {
        update("invalid");
        return "invalid";
      }
      update("saving");
      const epoch = epochRef.current;
      const attempt = optsRef.current.save(v).then(
        () => {
          if (epoch !== epochRef.current) return true;
          savedRef.current = v;
          if (mountedRef.current) setSaved(v);
          return true;
        },
        (err) => {
          const message = errorMessage(err);
          if (mountedRef.current) update("error", message);
          // Nobody is left to show it: say so rather than lose the edit quietly.
          else window.alert(`A change could not be saved: ${message}`);
          return false;
        },
      );
      inflightRef.current = attempt;
      const ok = await attempt;
      inflightRef.current = null;
      if (!ok) return "error";
      // Loop: edits made during the save go out next, or the status settles.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = useCallback(
    (patch: Partial<T> | ((value: T) => T), setOpts?: { immediate?: boolean }) => {
      const prev = valueRef.current;
      const next =
        typeof patch === "function" ? (patch as (v: T) => T)(prev) : ({ ...prev, ...patch } as T);
      valueRef.current = next;
      setValue(next);
      if (!enabled()) return;
      clearTimer();
      if (equals(next, savedRef.current)) {
        if (!inflightRef.current && mountedRef.current) {
          setStatus((s) => (s === "idle" ? s : "saved"));
          setError(null);
        }
        return;
      }
      // Validation waits for the same pause as a save, so a half-typed value
      // is not flagged on every keystroke; flush() decides "invalid".
      const delay = optsRef.current.delay === undefined ? AUTOSAVE_DELAY : optsRef.current.delay;
      if (setOpts?.immediate || delay === 0) {
        void flush();
      } else {
        update("pending");
        if (delay !== null) timerRef.current = setTimeout(() => void flush(), delay);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flush],
  );

  const reset = useCallback((next: T) => {
    clearTimer();
    epochRef.current += 1;
    valueRef.current = next;
    savedRef.current = next;
    setValue(next);
    setSaved(next);
    update("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the form saves what was typed; closing the tab with an unsaved
  // edit asks first.
  useEffect(() => {
    mountedRef.current = true;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (enabled() && !equals(valueRef.current, savedRef.current)) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      mountedRef.current = false;
      if (enabled() && !equals(valueRef.current, savedRef.current)) void flush();
      else clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = enabled() && !equals(value, saved);
  const errs = status === "invalid" && dirty ? optsRef.current.validate?.(value) : null;
  return {
    value,
    set,
    flush,
    reset,
    status,
    error,
    fieldErrors: (errs ?? {}) as FieldErrors<T>,
    dirty,
  };
}
