// Edits a list of short strings (persona traits, acceptance criteria, ...):
// one input per line, remove buttons, and an Add row. Enter in the last row
// adds another so a list can be typed straight through.
import { KeyboardEvent } from "react";

interface ListEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  disabled?: boolean;
}

export function ListEditor({ value, onChange, placeholder, addLabel = "Add", disabled }: ListEditorProps) {
  const set = (i: number, text: string) => onChange(value.map((v, j) => (j === i ? text : v)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => onChange([...value, ""]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (i === value.length - 1) add();
    }
  };

  return (
    <div className="list-editor">
      {value.map((item, i) => (
        <div className="list-editor-row" key={i}>
          <input
            className="input"
            value={item}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => onKey(e, i)}
          />
          <button type="button" className="btn icon" aria-label="Remove" title="Remove" onClick={() => remove(i)} disabled={disabled}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn small ghost" onClick={add} disabled={disabled}>
        + {addLabel}
      </button>
    </div>
  );
}

/** Drop blank rows before saving. */
export const cleanList = (items: string[]) => items.map((s) => s.trim()).filter(Boolean);
