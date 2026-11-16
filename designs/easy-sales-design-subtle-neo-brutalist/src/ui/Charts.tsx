// The wireframe's `graph` components, drawn with inline SVG. One series each,
// in the accent colour; gridlines and labels in the neutrals. Each chart
// measures its container and draws at that width, so its 12px labels stay
// 12px on a phone and on a wide desktop.
import { useLayoutEffect, useRef, useState } from "react";

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(values: number[], fixed?: number) {
  if (fixed) return fixed;
  const max = Math.max(...values, 1);
  const step = max > 50 ? 20 : max > 20 ? 10 : 5;
  return Math.ceil(max / step) * step;
}

function ticks(max: number) {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
}

export function LineChart({
  categories,
  values,
  unit = "%",
  max,
  label,
  denseXAxis,
}: {
  categories: string[];
  values: number[];
  unit?: string;
  max?: number;
  label: string;
  denseXAxis?: boolean;
}) {
  const [ref, W] = useWidth();
  const H = denseXAxis ? 300 : 240;
  const pad = { l: 40, r: 16, t: 12, b: denseXAxis ? 88 : 32 };
  const top = niceMax(values, max);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, categories.length - 1);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `M${x(0)},${y(0)} L${points.replace(/ /g, " L")} L${x(values.length - 1)},${y(0)} Z`;
  return (
    <div ref={ref} className="chart-box">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks(top).map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="chart-tick" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {t}
              {unit}
            </text>
          </g>
        ))}
        <path className="chart-area" d={area} />
        <polyline className="chart-line" points={points} />
        {values.map((v, i) => (
          <g key={i}>
            <circle className="chart-point" cx={x(i)} cy={y(v)} r={4}>
              <title>
                {categories[i]}: {v}
                {unit}
              </title>
            </circle>
          </g>
        ))}
        {categories.map((c, i) => (
          <text
            key={`${c}-${i}`}
            className="chart-tick"
            x={x(i)}
            y={denseXAxis ? H - pad.b + 16 : H - 10}
            textAnchor={denseXAxis ? "end" : "middle"}
            transform={denseXAxis ? `rotate(-42 ${x(i)} ${H - pad.b + 16})` : undefined}
          >
            {denseXAxis ? c : c.length > 9 ? c.slice(0, 3) : c}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function ColumnChart({
  categories,
  values,
  unit = "",
  label,
}: {
  categories: string[];
  values: number[];
  unit?: string;
  label: string;
}) {
  const [ref, W] = useWidth();
  const H = 260;
  const pad = { l: 40, r: 16, t: 12, b: 32 };
  const top = niceMax(values);
  const band = (W - pad.l - pad.r) / categories.length;
  const bar = Math.min(48, band * 0.5);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  return (
    <div ref={ref} className="chart-box">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks(top).map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="chart-tick" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {t}
              {unit}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = pad.l + band * i + band / 2;
          return (
            <g key={i}>
              <rect className="chart-bar" x={cx - bar / 2} y={y(v)} width={bar} height={y(0) - y(v)} rx={3}>
                <title>
                  {categories[i]}: {v}
                  {unit}
                </title>
              </rect>
              <text className="chart-value" x={cx} y={y(v) - 6} textAnchor="middle">
                {v}
                {unit}
              </text>
              <text className="chart-tick" x={cx} y={H - 10} textAnchor="middle">
                {categories[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The lowest level of the score hierarchy: one percentage per data point. */
export function DataPointChart({
  data,
  label,
}: {
  data: { step: string; label: string; score: number }[];
  label: string;
}) {
  const groups = Array.from(new Set(data.map((item) => item.step))).map((step) => ({
    step,
    items: data.filter((item) => item.step === step),
  }));

  return (
    <div className="data-point-chart" role="table" aria-label={label}>
      <div className="visually-hidden" role="row">
        <span role="columnheader">Data point</span>
        <span role="columnheader">Score</span>
      </div>
      <div className="data-point-groups">
        {groups.map((group) => (
          <section className="data-point-group" role="rowgroup" data-step={group.step} key={group.step}>
            <div className="data-point-group-head">
              <h3>{group.step}</h3>
            </div>
            <div className="data-point-group-rows">
              {group.items.map((item) => (
                <div className="data-point-row" role="row" key={`${item.step}-${item.label}`}>
                  <strong className="data-point-name" role="rowheader">
                    {item.label}
                  </strong>
                  <span className="data-point-measure data-point-score" role="cell">
                    <span className="data-point-track" aria-hidden="true">
                      <span className="data-point-fill" style={{ width: `${item.score}%` }} />
                    </span>
                    <strong>{item.score}%</strong>
                  </span>
                </div>
              ))}
              {group.items.length % 2 === 1 && <span className="data-point-empty" aria-hidden="true" />}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
