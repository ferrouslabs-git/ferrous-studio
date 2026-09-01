// One editable token on the canvas. Commits on Enter or blur, cancels on
// Escape; one commit = one undo step (keystrokes never reach the document).
//
// Tokens that are addressable elements (nav items, buttons…) also carry
// `element`: a single click selects the element, and — when it is linked —
// a double click follows the link instead of opening the text editor
// (Enter/F2 with the element selected, or the Inspector, edit its text).
import { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, useEffect, useRef, useState } from "react";

export interface TokenElement {
  selected: boolean;
  linked: boolean;
  /** External request (Enter/F2 in the studio) to open the inline editor. */
  editing: boolean;
  onSelect?: () => void;
  onFollow?: () => void;
  onEditEnd?: () => void;
}

interface Props {
  value: string;
  onCommit?: (next: string) => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;
  element?: TokenElement;
}

export function EditableToken({ value, onCommit, className, style, title, children, element }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(72);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  const begin = () => {
    setWidth(Math.max(72, Math.ceil(ref.current?.getBoundingClientRect().width ?? 72)));
    setText(value);
    setEditing(true);
  };

  // Enter/F2 with the element selected opens the editor from outside.
  useEffect(() => {
    if (element?.editing && onCommit && !editing) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element?.editing]);

  const cls = [className ?? ""];
  if (element?.selected) cls.push("el-sel");
  if (element?.linked) cls.push("linked");
  const classes = cls.join(" ").trim();

  if (!onCommit) {
    // Read-only (viewers): linked elements still follow on double click.
    return (
      <span
        className={classes}
        style={style}
        title={element?.linked ? "Double-click to follow link" : title}
        onDoubleClick={
          element?.linked && element.onFollow
            ? (e) => {
                e.stopPropagation();
                element.onFollow!();
              }
            : undefined
        }
      >
        {children ?? value}
      </span>
    );
  }

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    element?.onSelect?.();
  };

  const onDouble = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (element?.linked && element.onFollow) {
      element.onFollow();
      return;
    }
    begin();
  };

  const commit = () => {
    setEditing(false);
    element?.onEditEnd?.();
    if (text !== value) onCommit(text);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      element?.onEditEnd?.();
    }
  };

  if (editing) {
    return (
      <input
        className="inline-edit-input"
        style={{ width }}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.target.select()}
        draggable={false}
      />
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      style={style}
      title={
        title ??
        (element?.linked ? "Click to select · double-click to follow link" : element ? "Click to select · double-click to edit" : "Double-click to edit")
      }
      onClick={onClick}
      onDoubleClick={onDouble}
      draggable={false}
    >
      {children ?? value}
    </button>
  );
}
