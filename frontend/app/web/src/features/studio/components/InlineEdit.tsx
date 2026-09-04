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
  /** Preview mode: a linked read-only token follows on a single click, the
   *  way the real system would. */
  followOnClick?: boolean;
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
  /** Drag-and-drop handlers (element reorder); spread on the idle button only. */
  drag?: Record<string, unknown>;
}

export function EditableToken({ value, onCommit, className, style, title, children, element, drag }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(72);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  const begin = () => {
    setWidth(Math.max(72, ref.current?.offsetWidth ?? 72));
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
    // Read-only. In preview a linked element navigates on a single click,
    // like the control it stands for; viewers follow on double click.
    if (element?.linked && element.onFollow && element.followOnClick) {
      return (
        <span
          className={classes}
          style={style}
          role="link"
          onClick={(e) => {
            e.stopPropagation();
            element.onFollow!();
          }}
        >
          {children ?? value}
        </span>
      );
    }
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
      {...drag}
    >
      {children ?? value}
    </button>
  );
}
