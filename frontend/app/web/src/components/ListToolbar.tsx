// The strip above a list: search, the filters that narrow it, a Clear button
// once anything is set, and how many rows are showing. Every list reads the
// same way, so the page only says what can be searched and filtered on.
import { countOf } from "../core/format";

export interface ListFilter {
  /** Accessible name, "Filter by status". */
  label: string;
  value: string;
  /** The value Clear returns it to; "" unless the list opens filtered. */
  defaultValue?: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

interface ListToolbarProps {
  search: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    /** Accessible name, "Search projects". */
    label: string;
  };
  filters?: ListFilter[];
  /** How many rows are showing, of how many there are, and what they are. */
  count: { visible: number; total: number; noun: [string, string] };
}

export function ListToolbar({ search, filters = [], count }: ListToolbarProps) {
  const filtered = search.value.trim() !== "" || filters.some((f) => f.value !== (f.defaultValue ?? ""));
  const clear = () => {
    search.onChange("");
    for (const f of filters) f.onChange(f.defaultValue ?? "");
  };

  return (
    <div className="toolbar list-toolbar">
      <input
        className="input search"
        type="search"
        placeholder={search.placeholder}
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
        aria-label={search.label}
      />
      {filters.map((f) => (
        <select key={f.label} className="select" value={f.value} onChange={(e) => f.onChange(e.target.value)} aria-label={f.label}>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {filtered && (
        <button type="button" className="btn small ghost" onClick={clear}>
          Clear
        </button>
      )}
      <span className="list-count" aria-live="polite">
        {countOf(count.visible, count.total, count.noun)}
      </span>
    </div>
  );
}

/** Case-insensitive "any of these fields contains the query". */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}
