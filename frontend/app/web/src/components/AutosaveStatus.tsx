// The save-state readout for an autosaving form: a small badge while all is
// well, and a warning with a Retry button when a save failed.
import { Autosave } from "../core/useAutosave";

export function AutosaveStatus({ auto }: { auto: Pick<Autosave<unknown>, "status" | "error" | "flush"> }) {
  switch (auto.status) {
    case "pending":
      return (
        <span className="badge muted autosave-status" role="status">
          Unsaved
        </span>
      );
    case "saving":
      return (
        <span className="badge accent autosave-status" role="status">
          Saving…
        </span>
      );
    case "saved":
      return (
        <span className="badge good autosave-status" role="status">
          Saved
        </span>
      );
    case "invalid":
      return (
        <span className="badge warn autosave-status" role="status">
          Not saved
        </span>
      );
    case "error":
      return (
        <span className="status-banner warn autosave-status autosave-error" role="alert">
          Not saved: {auto.error}
          <button type="button" className="btn small" onClick={() => void auto.flush()}>
            Retry
          </button>
        </span>
      );
    default:
      return null;
  }
}

/**
 * Close an autosaving form: save anything pending first, and stay open when
 * that save fails so the error is seen. An invalid value was never sent; its
 * field errors were on show, and closing abandons it.
 */
export async function closeAfterSave(auto: Pick<Autosave<unknown>, "flush">, close: () => void) {
  if ((await auto.flush()) !== "error") close();
}

/** The footer of an autosaving drawer: the readout, then Close. */
export function AutosaveFooter({
  auto,
  onClose,
}: {
  auto: Pick<Autosave<unknown>, "status" | "error" | "flush">;
  onClose: () => void;
}) {
  return (
    <>
      <AutosaveStatus auto={auto} />
      <span className="shell-spacer" />
      <button
        type="button"
        className="btn"
        onClick={() => void closeAfterSave(auto, onClose)}
      >
        Close
      </button>
    </>
  );
}
