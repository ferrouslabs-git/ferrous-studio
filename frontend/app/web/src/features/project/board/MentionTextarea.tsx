// The comment composer's textarea with @-mentions (FS-REQ-80): typing "@"
// offers the people who can see the board -- the organisation's members and
// super admins, the same list work is assigned from -- and picking one puts
// "@Name" in the text and records who it stands for. The parent turns the
// text into the stored form with toStored() when it saves.
import { ClipboardEvent, KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import type { Assignee } from "./assigneesApi";
import { useBoard } from "./boardData";
import { activeQuery, insertMention, matchPeople, PickedMention } from "./mentions";

interface MentionTextareaProps {
  value: string;
  onChange: (text: string) => void;
  picked: PickedMention[];
  onPick: (picked: PickedMention[]) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Keys the list does not take (it takes arrows, Enter, Tab and Escape while open). */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function MentionTextarea({ value, onChange, picked, onPick, placeholder, disabled, autoFocus, onPaste, onKeyDown }: MentionTextareaProps) {
  const { members } = useBoard();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const options: Assignee[] = query ? matchPeople(members, query.query) : [];
  const open = !!query && options.length > 0;

  const track = (text: string, caret: number) => {
    const q = activeQuery(text, caret);
    setQuery(q);
    if (q?.query !== query?.query) setActive(0);
  };

  const pick = (person: Assignee) => {
    const el = ref.current;
    if (!query || !el) return;
    const next = insertMention(value, query.start, el.selectionStart ?? value.length, person.name);
    onChange(next.text);
    if (!picked.some((p) => p.id === person.user_id && p.name === person.name)) {
      onPick([...picked.filter((p) => p.name !== person.name), { id: person.user_id, name: person.name }]);
    }
    setQuery(null);
    // Placed once the new text has rendered (below), before anything else is typed.
    caretAfterRender.current = next.caret;
    el.focus();
  };

  const caretAfterRender = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caretAfterRender.current !== null) {
      el.setSelectionRange(caretAfterRender.current, caretAfterRender.current);
      caretAfterRender.current = null;
    }
  }, [value]);

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[Math.min(active, options.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="mention-wrap">
      <textarea
        ref={ref}
        className="rqp-cmt"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onKeyUp={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
            track(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }
        }}
        onBlur={() => setQuery(null)}
        onKeyDown={keyDown}
        onPaste={onPaste}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? "mention-list" : undefined}
      />
      {open && (
        <ul className="mention-pop" id="mention-list" role="listbox" aria-label="People">
          {options.map((p, i) => (
            <li
              key={p.user_id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : undefined}
              // mousedown, not click: the textarea's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {p.name}
              {p.super_admin && <span className="mention-tag">Super admin</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
