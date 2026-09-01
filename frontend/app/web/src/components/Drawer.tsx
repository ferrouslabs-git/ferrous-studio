// Right-hand slide-out panel for create/edit forms. Backdrop click and Escape
// close it; the first input is focused on open; the page behind stays put so
// the user keeps their context. `footer` is where the form's actions go.
import { FormEvent, ReactNode, useEffect, useRef } from "react";

interface DrawerProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  /** When set the body is a <form>; submitting calls this. */
  onSubmit?: (e: FormEvent) => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
  /** Extra class on the panel, for callers that need to restyle the body. */
  className?: string;
}

export function Drawer({ open, title, description, onClose, onSubmit, footer, children, width = 440, className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers usually pass an inline arrow for onClose, which has a new identity
  // on every render. Read it through a ref so the effect below only re-runs
  // when the drawer opens -- otherwise each keystroke would steal focus back
  // to the first field.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    // Focus the first field so keyboard users can start typing straight away.
    const first = panelRef.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.drawer-close)");
    first?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const body = (
    <>
      <div className="drawer-body">{children}</div>
      {footer && <div className="drawer-footer">{footer}</div>}
    </>
  );

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} />
      <div
        className={className ? `drawer ${className}` : "drawer"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={panelRef}
        style={{ width }}
      >
        <div className="drawer-head">
          <div>
            <h2 id="drawer-title">{title}</h2>
            {description && <p className="drawer-desc">{description}</p>}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </div>
        {onSubmit ? (
          <form className="drawer-form" onSubmit={onSubmit}>
            {body}
          </form>
        ) : (
          <div className="drawer-form">{body}</div>
        )}
      </div>
    </div>
  );
}

/** Stacked labelled field for drawer forms. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="drawer-field">
      <span className="drawer-field-label">{label}</span>
      {children}
      {hint && <span className="drawer-field-hint">{hint}</span>}
    </label>
  );
}
