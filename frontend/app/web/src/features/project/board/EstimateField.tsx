// The estimate control: a preset ladder of chips plus a number box for the
// genuinely odd value. Ported from the reference app's estimateField()
// (static/js/effort.js). Null is "not estimated", a real state distinct
// from zero; clicking the selected chip again clears it.
import { useEffect, useState } from "react";
import { EST_PRESETS, EST_SPLIT_HINT_HOURS, fmtEffort } from "./effort";

interface EstimateFieldProps {
  value: number | null;
  onChange: (hours: number | null) => void;
  disabled?: boolean;
}

export function EstimateField({ value, onChange, disabled = false }: EstimateFieldProps) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);

  const parse = (s: string): number | null => {
    const v = s.trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const commitText = () => {
    const next = parse(text);
    setText(next == null ? "" : String(next));
    if (next !== value) onChange(next);
  };
  const pick = (h: number | null) => {
    const next = h === value ? null : h;
    setText(next == null ? "" : String(next));
    onChange(next);
  };
  const over = value != null && value > EST_SPLIT_HINT_HOURS;

  return (
    <div className="estfield">
      <div className="est-row">
        <input
          type="number"
          className="input est-input"
          min={0}
          step={0.5}
          placeholder="—"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            }
          }}
        />
        <span className={`est-read${value == null ? " est-none" : over ? " est-warn" : ""}`}>
          {value == null ? "not estimated" : over ? `${fmtEffort(value)} · over a week` : fmtEffort(value)}
        </span>
      </div>
      <div className="est-chips">
        {EST_PRESETS.map((h) => (
          <button
            key={h}
            type="button"
            className={`est-chip${value === h ? " on" : ""}`}
            disabled={disabled}
            onClick={() => pick(h)}
          >
            {fmtEffort(h)}
          </button>
        ))}
        <button
          type="button"
          className={`est-chip est-clear${value == null ? " on" : ""}`}
          title="not estimated"
          disabled={disabled}
          onClick={() => pick(null)}
        >
          —
        </button>
      </div>
    </div>
  );
}
