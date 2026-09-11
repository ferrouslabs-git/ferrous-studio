// Promise-style dialogs for the board pages -- confirm, a short form, a
// picker -- rendered in the app's slide-out drawers rather than
// window.confirm/prompt (which block the event loop and cannot be styled).
// Ported from the reference app's uiConfirm/uiForm/uiPick (static/js/core.js).
// One dialog at a time; Escape, Cancel or a backdrop click resolve the
// fallback (false / null), never throw.
import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  /** The confirming button's label; defaults to "Delete". */
  ok?: string;
  /** False for something that is not destructive (ship, complete, start). */
  danger?: boolean;
}

export type FormFieldType = "text" | "textarea" | "select" | "date" | "number";

export interface FormField {
  key: string;
  label: string;
  type?: FormFieldType;
  value?: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface FormOptions {
  title: string;
  /** A state readout above the fields (e.g. what the form will affect). */
  message?: ReactNode;
  ok?: string;
  fields: FormField[];
  width?: number;
}

export interface PickItem {
  value: string;
  label: string;
  hint?: string;
}

export interface PickOptions {
  title: string;
  /** A state readout above the list (e.g. why some choices are missing). */
  message?: ReactNode;
  items: PickItem[];
}

export interface Dialogs {
  confirm(opts: ConfirmOptions): Promise<boolean>;
  form(opts: FormOptions): Promise<Record<string, string> | null>;
  pick(opts: PickOptions): Promise<string | null>;
  /** True while any dialog is up; a drawer underneath uses it to ignore Escape. */
  isOpen: boolean;
  /**
   * Count a modal that is not one of these dialogs (the attachment lightbox)
   * as open until the returned release is called, so a drawer beneath leaves
   * Escape to it exactly as it would to a dialog -- the reference's dialog
   * stack pre-empts every other Escape handler (static/js/core.js).
   */
  hold(): () => void;
}

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "form"; opts: FormOptions; resolve: (v: Record<string, string> | null) => void }
  | { kind: "pick"; opts: PickOptions; resolve: (v: string | null) => void };

const DialogContext = createContext<Dialogs | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [held, setHeld] = useState(0);

  const hold = useCallback(() => {
    setHeld((n) => n + 1);
    return () => setHeld((n) => n - 1);
  }, []);

  const close = useCallback(() => {
    const cur = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (!cur) return;
    // Resolve the dialog's fallback: a dismissed dialog is a "no", never an error.
    if (cur.kind === "confirm") cur.resolve(false);
    else cur.resolve(null);
  }, []);

  const open = useCallback(
    (next: Pending) => {
      // Only ever one dialog at a time: a second request dismisses the first.
      if (pendingRef.current) close();
      pendingRef.current = next;
      setPending(next);
    },
    [close],
  );

  const settle = useCallback(<T,>(value: T, resolve: (v: T) => void) => {
    pendingRef.current = null;
    setPending(null);
    resolve(value);
  }, []);

  const dialogs = useMemo<Dialogs>(
    () => ({
      confirm: (opts) => new Promise<boolean>((resolve) => open({ kind: "confirm", opts, resolve })),
      form: (opts) => new Promise<Record<string, string> | null>((resolve) => open({ kind: "form", opts, resolve })),
      pick: (opts) => new Promise<string | null>((resolve) => open({ kind: "pick", opts, resolve })),
      isOpen: pending !== null || held > 0,
      hold,
    }),
    [open, pending, held, hold],
  );

  return (
    <DialogContext.Provider value={dialogs}>
      {children}
      {pending?.kind === "confirm" && (
        <ConfirmDrawer
          open
          title={pending.opts.title ?? "Are you sure?"}
          confirmLabel={pending.opts.ok ?? "Delete"}
          danger={pending.opts.danger !== false}
          onClose={close}
          onConfirm={async () => settle(true, pending.resolve)}
        >
          <div className="board-dialog-message">{pending.opts.message}</div>
        </ConfirmDrawer>
      )}
      {pending?.kind === "form" && (
        <FormDrawer opts={pending.opts} onCancel={close} onSubmit={(values) => settle(values, pending.resolve)} />
      )}
      {pending?.kind === "pick" && (
        <PickerDrawer opts={pending.opts} onCancel={close} onPick={(value) => settle(value, pending.resolve)} />
      )}
    </DialogContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used inside DialogProvider");
  return ctx;
}

/** Marks the calling component as a modal (see Dialogs.hold) for as long as it is mounted. */
export function useModalHold(): void {
  const { hold } = useDialogs();
  useEffect(() => hold(), [hold]);
}

// ── a short form: labelled fields, Enter submits, required is enforced ──────

function FormDrawer({
  opts,
  onCancel,
  onSubmit,
}: {
  opts: FormOptions;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(opts.fields.map((f) => [f.key, f.value ?? ""])),
  );
  const set = (key: string, v: string) => setValues((cur) => ({ ...cur, [key]: v }));
  const missing = opts.fields.some((f) => f.required && !values[f.key]?.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (missing) return;
    onSubmit(Object.fromEntries(opts.fields.map((f) => [f.key, (values[f.key] ?? "").trim()])));
  };

  return (
    <Drawer
      open
      title={opts.title}
      onClose={onCancel}
      onSubmit={submit}
      width={opts.width ?? 440}
      className="board-drawer"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={missing}>
            {opts.ok ?? "Save"}
          </button>
        </>
      }
    >
      {opts.message && <div className="board-dialog-message">{opts.message}</div>}
      {opts.fields.map((f) => (
        <Field key={f.key} label={f.label}>
          {f.type === "textarea" ? (
            <textarea
              className="input textarea"
              rows={4}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              required={f.required}
              onChange={(e) => set(f.key, e.target.value)}
            />
          ) : f.type === "select" ? (
            <select className="select" value={values[f.key] ?? ""} required={f.required} onChange={(e) => set(f.key, e.target.value)}>
              {(!f.value || !f.required) && <option value="">{f.placeholder ?? "— pick one —"}</option>}
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              type={f.type ?? "text"}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              required={f.required}
              onChange={(e) => set(f.key, e.target.value)}
            />
          )}
        </Field>
      ))}
    </Drawer>
  );
}

// ── a picker: one button per item, with an optional hint on the right ───────

function PickerDrawer({
  opts,
  onCancel,
  onPick,
}: {
  opts: PickOptions;
  onCancel: () => void;
  onPick: (value: string) => void;
}) {
  return (
    <Drawer
      open
      title={opts.title}
      onClose={onCancel}
      width={440}
      className="board-drawer"
      footer={
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      }
    >
      {opts.message && <div className="board-dialog-message">{opts.message}</div>}
      <div className="dlg-list">
        {opts.items.length === 0 && <div className="hempty">Nothing to pick from.</div>}
        {opts.items.map((it) => (
          <button key={it.value} type="button" className="dlg-item" onClick={() => onPick(it.value)}>
            <span>{it.label}</span>
            {it.hint && <span className="dlg-hint">{it.hint}</span>}
          </button>
        ))}
      </div>
    </Drawer>
  );
}
