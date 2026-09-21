// A checklist behind a button: pick several of something, or none to mean
// "all". Modelled on the use case diagram's user-type picker so the two read
// the same, but with nothing board-specific in it -- the caller supplies the
// options and holds the selection.
//
// An empty selection is "everything", not "nothing": a filter that starts by
// hiding the whole page would be a trap, and there is then no such thing as
// an invalid state to guard against.
import { useEffect, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** A second line under the label -- a count, a date, a status. */
  hint?: string;
}

interface MultiSelectProps {
  /** Shown on the button when nothing is picked. */
  allLabel: string;
  /** Plural noun for "3 releases"; falls back to allLabel. */
  countLabel?: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  ariaLabel: string;
  className?: string;
}

export function MultiSelect({ allLabel, countLabel, options, selected, onChange, ariaLabel, className }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const chosen = options.filter((o) => selected.has(o.value));
  const label = chosen.length === 0 ? allLabel : chosen.length === 1 ? chosen[0].label : `${chosen.length} ${countLabel ?? allLabel}`;

  return (
    <div className={`bmulti${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        className={`select bmulti-button${chosen.length ? " is-set" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="bmulti-label">{label}</span>
        <span className="bmulti-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="bmulti-menu" role="listbox" aria-multiselectable="true" aria-label={ariaLabel}>
          <label className="bmulti-check">
            <input type="checkbox" checked={selected.size === 0} onChange={() => onChange(new Set())} />
            <span>{allLabel}</span>
          </label>
          <div className="bmulti-divider" />
          {options.map((o) => (
            <label key={o.value} className="bmulti-check" role="option" aria-selected={selected.has(o.value)}>
              <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
              <span className="bmulti-text">
                {o.label}
                {o.hint && <small>{o.hint}</small>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
