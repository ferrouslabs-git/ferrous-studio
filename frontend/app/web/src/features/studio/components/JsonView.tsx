// Syntax-highlighted JSON rendered as React elements (no HTML strings).
// Class names match the legacy .json .k/.s/.n/.p styling.
import { Fragment, ReactNode } from "react";

function render(value: unknown, indent: number, key: number): ReactNode {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") return <span key={key} className="s">{JSON.stringify(value)}</span>;
    if (typeof value === "number") return <span key={key} className="n">{String(value)}</span>;
    return <Fragment key={key}>{String(value)}</Fragment>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span key={key} className="p">[]</span>;
    return (
      <Fragment key={key}>
        <span className="p">[</span>
        {value.map((v, i) => (
          <Fragment key={i}>
            {"\n"}{inner}{render(v, indent + 1, i)}
            {i < value.length - 1 && <span className="p">,</span>}
          </Fragment>
        ))}
        {"\n"}{pad}<span className="p">]</span>
      </Fragment>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return <span key={key} className="p">{"{}"}</span>;
  return (
    <Fragment key={key}>
      <span className="p">{"{"}</span>
      {entries.map(([k, v], i) => (
        <Fragment key={k}>
          {"\n"}{inner}<span className="k">{JSON.stringify(k)}</span>: {render(v, indent + 1, i)}
          {i < entries.length - 1 && <span className="p">,</span>}
        </Fragment>
      ))}
      {"\n"}{pad}<span className="p">{"}"}</span>
    </Fragment>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json">{render(value, 0, 0)}</pre>;
}
