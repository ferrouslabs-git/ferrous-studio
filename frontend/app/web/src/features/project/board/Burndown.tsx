// A sprint's burndown, loaded when its <details> is first opened. Three
// series -- remaining (solid), ideal pace (dashed), scope (dotted, stepped:
// scope changes are discrete events) -- in hours when every requirement is
// estimated, else in item counts, and the fallback says so out loud. The
// chart library is fetched on first use; most sessions never open one.
// Ported from the reference app's renderBurndown() (static/js/sprints.js).
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { useBoard } from "./boardData";
import { fmtEffort } from "./effort";
import { Burndown as BurndownData, getBurndown } from "./sprintsApi";
import { cssVar, useThemeAttr } from "./useThemeAttr";

type Mode = "hours" | "items";

const canUseHours = (d: BurndownData) => !d.unestimated_count && d.total_hours > 0;

function series(d: BurndownData, mode: Mode) {
  const hours = mode === "hours";
  return {
    hours,
    remaining: hours ? d.remaining_hours : d.remaining,
    ideal: hours ? d.ideal_hours : d.ideal,
    scope: hours ? d.scope_hours : d.scope,
    total: hours ? d.total_hours : d.total,
    fmt: hours ? fmtEffort : (v: number) => String(v),
  };
}

const shortDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Which sprints have their burndown expanded -- module-level, like the
// reference's bdOpen (static/js/sprints.js), so a chart you opened is still
// open after drilling into "board ↗" (or any other page) and coming back,
// not just across the re-renders every patch triggers. Session-only on
// purpose: sprint ids are unique across projects, and a reload starts folded.
const bdOpen = new Set<string>();

export function BurndownDetails({ sprintId }: { sprintId: string }) {
  const { projectId } = useBoard();
  const [open, setOpen] = useState(() => bdOpen.has(sprintId));
  const [data, setData] = useState<BurndownData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    if (!open || data || error) return;
    let cancelled = false;
    getBurndown(projectId, sprintId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setMode(canUseHours(d) ? "hours" : "items");
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [open, data, error, projectId, sprintId]);

  return (
    <details
      className="bd-details"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        if (next) bdOpen.add(sprintId);
        else bdOpen.delete(sprintId);
        if (!next) return;
        setError(null);
      }}
    >
      <summary>burndown</summary>
      <div className="bd-body">
        {!open ? null : error ? (
          <div className="hempty">couldn't load burndown — {error}</div>
        ) : !data || !mode ? (
          <div className="hempty">loading…</div>
        ) : (
          <BurndownChart data={data} mode={mode} onMode={setMode} />
        )}
      </div>
    </details>
  );
}

function BurndownChart({ data, mode, onMode }: { data: BurndownData; mode: Mode; onMode: (m: Mode) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeAttr();
  const [libError, setLibError] = useState(false);

  if (!data.dates.length) return <div className="hempty">{data.note || "no requirements have been in this sprint yet"}</div>;

  const S = series(data, mode);
  let lastIdx = -1;
  S.remaining.forEach((v, i) => {
    if (v != null) lastIdx = i;
  });
  const behind = lastIdx >= 0 && (S.remaining[lastIdx] ?? 0) > (S.ideal[lastIdx] ?? 0);
  const added = lastIdx >= 0 && (S.scope[lastIdx] ?? 0) > S.total;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let chart: { destroy(): void } | null = null;
    let cancelled = false;
    (async () => {
      let lib: typeof import("chart.js");
      try {
        lib = await import("chart.js");
      } catch {
        setLibError(true);
        return;
      }
      if (cancelled) return;
      const { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip } = lib;
      Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip);
      const root = canvas.closest(".board-page") ?? document.documentElement;
      const line = cssVar("--b-line-faint", root) || cssVar("--border");
      const ink3 = cssVar("--b-ink3", root) || cssVar("--text-mute");
      const mono = cssVar("--b-mono", root) || "monospace";
      const actual = behind ? cssVar("--b-serious", root) || cssVar("--bad") : cssVar("--b-accent-text", root) || cssVar("--accent");
      const scope = cssVar("--b-cobalt", root) || "#4a63ff";
      const tipBg = cssVar("--b-card", root) || cssVar("--panel-2");
      const tipInk = cssVar("--b-ink", root) || cssVar("--text");
      const s = series(data, mode);
      chart = new Chart(canvas, {
        type: "line",
        data: {
          labels: data.dates,
          datasets: [
            { label: "remaining", data: s.remaining, borderColor: actual, backgroundColor: actual, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0, spanGaps: false },
            { label: "ideal pace", data: s.ideal, borderColor: ink3, backgroundColor: ink3, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0 },
            { label: "scope", data: s.scope, borderColor: scope, backgroundColor: scope, borderWidth: 1.2, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 0, stepped: "before", spanGaps: false },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: tipBg,
              titleColor: tipInk,
              bodyColor: tipInk,
              padding: 8,
              cornerRadius: 4,
              titleFont: { family: mono, size: 11 },
              bodyFont: { family: mono, size: 10.5 },
              boxWidth: 8,
              boxHeight: 8,
              boxPadding: 4,
              callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y == null ? "—" : s.fmt(ctx.parsed.y)}` },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { color: line },
              ticks: { color: ink3, font: { family: mono, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, callback: (_v, i) => shortDate(data.dates[i]) },
            },
            y: {
              beginAtZero: true,
              grid: { color: line },
              border: { display: false },
              ticks: { color: ink3, font: { family: mono, size: 10 }, maxTicksLimit: 5, precision: s.hours ? 1 : 0, callback: (v) => s.fmt(Number(v)) },
            },
          },
        },
      });
    })();
    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [data, mode, theme, behind]);

  return (
    <>
      <div className="bd-legend">
        <span>
          <i className="bd-sw" style={{ background: behind ? "var(--b-serious)" : "var(--b-accent-text)" }} />
          remaining
        </span>
        <span>
          <i className="bd-sw bd-sw-dash" />
          ideal pace
        </span>
        <span>
          <i className="bd-sw bd-sw-scope" />
          scope
        </span>
        <span className="bd-modes">
          <button type="button" className={`bd-mode${mode === "hours" ? " on" : ""}`} disabled={!data.total_hours} onClick={() => onMode("hours")}>
            hours
          </button>
          <button type="button" className={`bd-mode${mode === "items" ? " on" : ""}`} onClick={() => onMode("items")}>
            items
          </button>
        </span>
      </div>
      {mode === "items" && data.unestimated_count > 0 && (
        <div className="bd-note">
          showing item counts — {data.unestimated_count} of {data.unestimated_count + data.estimated_count} requirement(s) have no estimate
        </div>
      )}
      {added && (
        <div className="bd-note bd-note-scope">
          scope grew during the sprint: started at {S.fmt(S.total)}, now {S.fmt(S.scope[lastIdx] ?? 0)}
        </div>
      )}
      <div className="bd-chart">{libError ? <div className="hempty">chart library didn't load — reload to try again</div> : <canvas ref={canvasRef} />}</div>
    </>
  );
}
