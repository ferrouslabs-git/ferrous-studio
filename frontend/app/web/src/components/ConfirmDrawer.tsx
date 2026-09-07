// Confirmation for destructive actions, in the same slide-out the rest of the
// app uses for forms -- never window.confirm().
import { ReactNode, useState } from "react";
import { errorMessage } from "../core/api";
import { Drawer } from "./Drawer";

interface ConfirmDrawerProps {
  open: boolean;
  title: string;
  /** What is about to happen and what it takes with it. */
  children: ReactNode;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
}

export function ConfirmDrawer({ open, title, children, confirmLabel = "Delete", onClose, onConfirm }: ConfirmDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      title={title}
      onClose={onClose}
      width={400}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">{children}</div>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}

/**
 * A confirmation a page has queued from a row menu: what it is for, what it
 * says, and what to run once agreed. A page holds one of these in state and
 * renders a single <ConfirmationDrawer> for all of its destructive actions,
 * rather than a drawer and a flag per action.
 */
export interface Confirmation {
  title: string;
  body: ReactNode;
  /** Defaults to "Delete"; reversible actions name themselves ("Suspend"). */
  confirmLabel?: string;
  run: () => Promise<unknown>;
}

export function ConfirmationDrawer({ pending, onClose }: { pending: Confirmation | null; onClose: () => void }) {
  return (
    <ConfirmDrawer
      open={pending !== null}
      title={pending?.title ?? ""}
      confirmLabel={pending?.confirmLabel}
      onClose={onClose}
      onConfirm={async () => {
        if (pending) await pending.run();
      }}
    >
      {pending?.body}
    </ConfirmDrawer>
  );
}
