// Double-click-to-edit token, ported from render.global.js startInlineEdit.
// Commits on Enter or blur, cancels on Escape. One commit = one undo step:
// keystrokes never reach the document.
import { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onCommit?: (next: string) => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;
}

export function EditableToken({ value, onCommit, className, style, title, children }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(72);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  if (!onCommit) {
    return (
      <span className={className} style={style}>
        {children ?? value}
      </span>
    );
  }

  const begin = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setWidth(Math.max(72, Math.ceil(ref.current?.getBoundingClientRect().width ?? 72)));
    setText(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (text !== value) onCommit(text);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
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
      className={className}
      style={style}
      title={title ?? "Double-click to edit"}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={begin}
      draggable={false}
    >
      {children ?? value}
    </button>
  );
}
