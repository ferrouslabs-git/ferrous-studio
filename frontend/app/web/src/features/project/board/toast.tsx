// Toasts for the board pages: feedback after a write, with an optional Undo.
// Ported from the reference app's static/js/core.js toast(). Mounted once by
// BoardProvider; pages call useToast(). The stack is a polite live region,
// so a drop or a status change is announced to assistive technology as well
// as shown.
import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

export interface ToastOptions {
  type?: "err";
  /**
   * Runs when Undo is pressed, after this toast is removed; it may toast
   * again (an undo that offers its own Undo), which is how boardMutations and
   * the sprint board make an undo reversible.
   */
  undo?: () => void;
  /** Milliseconds on screen; defaults to 3.5 s, or 7 s when there is an Undo. */
  ttl?: number;
}

export type ToastFn = (message: string, opts?: ToastOptions) => void;

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
  out?: boolean;
}

const ToastContext = createContext<ToastFn | null>(null);

const MAX_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);

  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      const id = ++seq.current;
      setItems((cur) => [...cur, { id, message, ...opts }].slice(-MAX_TOASTS));
      const ttl = opts.ttl ?? (opts.undo ? 7000 : 3500);
      window.setTimeout(() => {
        setItems((cur) => cur.map((t) => (t.id === id ? { ...t, out: true } : t)));
        window.setTimeout(() => remove(id), 350);
      }, ttl);
    },
    [remove],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="board-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`board-toast${t.type === "err" ? " err" : ""}${t.out ? " out" : ""}`}>
            <span>{t.message}</span>
            {t.undo && (
              <button
                type="button"
                className="t-undo"
                onClick={() => {
                  remove(t.id);
                  t.undo?.();
                }}
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
