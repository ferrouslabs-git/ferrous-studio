// A themed dropdown for "pick one of these, or type your own": a text input
// with a menu of suggestions underneath. Typing filters the menu; a value that
// matches nothing gets an "Add" row so unique entries are still one click away.
// Replaces the native <datalist>, which can't be styled to match the app.
import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

interface ComboBoxProps {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}

export function ComboBox({ value, onChange, options, placeholder, disabled }: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const query = value.trim();
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);
  // Offer to add the typed text unless it already exists in the list (case-insensitive).
  const canAdd = query !== "" && !options.some((o) => o.toLowerCase() === query.toLowerCase());
  const items = canAdd ? [...filtered, { add: query }] : filtered;

  // Close when clicking anywhere outside the control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (item: string | { add: string }) => {
    onChange(typeof item === "string" ? item : item.add);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (items.length ? (a + dir + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      if (open && items[active] !== undefined) {
        e.preventDefault(); // don't submit the drawer form
        pick(items[active]);
      }
    } else if (e.key === "Escape" && open) {
      e.stopPropagation(); // keep the drawer open; only close the menu
      setOpen(false);
    }
  };

  return (
    <div className={`combo${open ? " is-open" : ""}`} ref={root}>
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        aria-label={open ? "Close options" : "Show options"}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && items.length > 0 && (
        <ul className="combo-menu" role="listbox" id={listId}>
          {items.map((item, i) => {
            const isAdd = typeof item !== "string";
            return (
              <li
                key={isAdd ? "__add" : item}
                role="option"
                aria-selected={i === active}
                className={`combo-option${i === active ? " is-active" : ""}${isAdd ? " is-add" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep input focus
                onClick={() => pick(item)}
              >
                {isAdd ? (
                  <>
                    <span className="combo-add-mark">+</span> Add “{item.add}”
                  </>
                ) : (
                  item
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
