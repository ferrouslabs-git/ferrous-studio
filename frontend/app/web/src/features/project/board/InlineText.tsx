// Double-click-to-edit text. Idle, it is the text itself (with a hover
// pencil from board.css .editable); editing, it becomes a real input or
// textarea so the caret and selection behave. Enter and Escape both leave
// the field (Shift+Enter adds a line in a textarea), and the value is saved
// whenever it changed -- the reference's wireEditable() treats Escape
// exactly like Enter, as a way out, not as a revert. Replaces that
// contentEditable helper, which React could not keep in step with re-renders.
import { KeyboardEvent, useEffect, useRef, useState } from "react";

interface InlineTextProps {
  value: string;
  onSave: (value: string) => void | Promise<unknown>;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  /** The idle element; a block for titles and descriptions, a span in a row. */
  as?: "span" | "div";
}

export function InlineText({
  value,
  onSave,
  multiline = false,
  className,
  placeholder,
  disabled = false,
  title,
  as: Tag = "span",
}: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = fieldRef.current;
    el?.focus();
    el?.select();
  }, [editing]);

  const begin = () => {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
  };

  // Leaving the field (blur, Enter, Escape) is the save: once, guarded, so
  // the blur that follows a keyboard exit does not save a second time.
  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = draft.trim();
    if (next !== value.trim()) void onSave(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && !(multiline && e.shiftKey))) {
      e.preventDefault();
      commit();
    }
  };

  if (editing) {
    const shared = {
      className: `inline-edit${className ? ` ${className}` : ""}`,
      value: draft,
      onBlur: commit,
      onKeyDown,
      onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    };
    return multiline ? (
      <textarea ref={(el) => (fieldRef.current = el)} rows={3} {...shared} onChange={(e) => setDraft(e.target.value)} />
    ) : (
      <input ref={(el) => (fieldRef.current = el)} {...shared} onChange={(e) => setDraft(e.target.value)} />
    );
  }

  const empty = !value.trim();
  return (
    <Tag
      className={`${className ?? ""}${disabled ? "" : " editable"}${empty ? " is-empty" : ""}`.trim()}
      title={title ?? (disabled ? undefined : "double-click to edit")}
      onDoubleClick={(e) => {
        e.stopPropagation();
        begin();
      }}
    >
      {empty ? placeholder ?? "" : value}
    </Tag>
  );
}
