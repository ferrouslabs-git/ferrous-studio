// Super admin: the AWS bill, compact (INT-REQ-14, phase 1; redesigned 2026-11-19).
// A one-line header, a warning when free credits run out, four key figures, the daily chart (what we pay against
// what credits covered), where the money goes, and the last few months. Opening this page reads the last saved
// report and asks AWS nothing; "Refresh" is the only thing that calls Cost Explorer, and the server saves the result.
import { ReactNode, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import { CostReport, CostSnapshot, CostsResponse, NamedAmount, getCosts, refreshCosts } from "./cloudopsApi";
import { count, dailyNow, dayLabel, expectedPay, monthName, monthOptions, serviceName, share, usd } from "./cloudopsFormat";

const shortMonth = (iso: string) => monthName(iso).split(" ")[0];
const credited = (credits: number) => usd(Math.abs(credits));

function Kpi({ label, value, lead, title, children }: { label: string; value: string; lead?: boolean; title?: string; children?: ReactNode }) {
  return (
    <div className={lead ? "cloudops-kpi lead" : "cloudops-kpi"} title={title}>
      <span className="cloudops-kpi-label">{label}</span>
      <span className="cloudops-kpi-value">{value}</span>
      {children}
    </div>
  );
}

function KeyFigures({ report, past }: { report: CostReport; past: boolean }) {
  const mtd = report.month_to_date;
  const last = report.last_month;
  const pace = report.forecast?.at_current_pace;
  const expected = expectedPay(report);
  const today = dailyNow(report);
  const awsGuess = report.forecast?.month_usage;
  const days = report.daily.length || 1;
  return (
    <section className="cloudops-kpis" aria-label="Key figures">
      <Kpi label={past ? "We paid" : "We pay so far"} value={usd(mtd.before_vat)} lead>
        <span className="cloudops-kpi-sub">
          {usd(mtd.usage)} charges − {credited(mtd.credits)} credits
        </span>
        {mtd.vat !== 0 && <span className="cloudops-kpi-sub muted">+ {usd(mtd.vat)} VAT, reclaimed</span>}
      </Kpi>
      {!past && (
        <Kpi
          label={`Expected for ${shortMonth(report.period.month_start)}`}
          value={expected === null ? "—" : usd(expected)}
          title={awsGuess != null ? `AWS's own forecast: ${usd(awsGuess)} in charges.` : undefined}
        >
          {pace && (
            <span className="cloudops-kpi-sub">
              {usd(pace.month_usage)} charges − {credited(mtd.credits)} credits
            </span>
          )}
          {pace && <span className="cloudops-kpi-sub muted">at the last {pace.days} days' pace</span>}
        </Kpi>
      )}
      {past ? (
        <Kpi label="Daily average" value={usd(mtd.usage / days)}>
          <span className="cloudops-kpi-sub">charges over {days} days</span>
        </Kpi>
      ) : (
        <Kpi label="Daily spend now" value={today ? usd(today.now.amount) : "—"}>
          {today?.then && today.change !== null && (
            <span className="cloudops-kpi-sub">
              <span className={today.change <= 0 ? "cloudops-down" : "cloudops-up"}>
                {today.change <= 0 ? "▼" : "▲"} {Math.abs(Math.round(today.change * 100))}%
              </span>{" "}
              from {usd(today.then.amount)} on {dayLabel(today.then.date)}
            </span>
          )}
          {today && <span className="cloudops-kpi-sub muted">≈ {usd(today.now.amount * 30)} a month at this rate</span>}
        </Kpi>
      )}
      <Kpi label={past ? monthName(report.period.last_month_start) : "Last month"} value={usd(last.before_vat)}>
        {last.credits !== 0 ? (
          <span className="cloudops-kpi-sub">credits covered {credited(last.credits)}</span>
        ) : (
          <span className="cloudops-kpi-sub">{usd(last.usage)} charges</span>
        )}
      </Kpi>
    </section>
  );
}

/** Each day's charges as one bar: what we paid on top, what credits covered beneath; last month's average as a line. */
function DailyChart({ report }: { report: CostReport }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const credits = new Map((report.daily_credits ?? []).map((c) => [c.date, c.amount]));
  const rows = report.daily.map((d) => {
    const credit = Math.min(credits.get(d.date) ?? 0, d.amount);
    return { date: d.date, usage: d.amount, credit, pay: Math.max(0, d.amount - credit) };
  });
  const prev = report.daily_previous;
  const prevAvg = prev.length ? prev.reduce((s, d) => s + d.amount, 0) / prev.length : null;
  const [y, m] = report.period.month_start.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const top = Math.max(1, ...rows.map((r) => r.usage), prevAvg ?? 0);
  const step = top > 20 ? 10 : top > 8 ? 2 : 1;
  const max = Math.ceil(top / step) * step;
  const W = 720, H = 210, L = 40, R = 8, T = 10, B = 22;
  const plotW = W - L - R, plotH = H - T - B, slot = plotW / daysInMonth, bw = Math.max(4, Math.min(16, slot - 4));
  const yOf = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const hovered = hover === null ? null : rows[hover];
  const hasCredits = rows.some((r) => r.credit > 0);

  return (
    <section className="cloudops-card cloudops-daily" aria-label="Daily charges">
      <div className="cloudops-card-head">
        <h2>Daily charges, {shortMonth(report.period.month_start)}</h2>
        <div className="cloudops-legend" aria-hidden="true">
          <span>
            <i className="cloudops-sw pay" />
            We pay
          </span>
          {hasCredits && (
            <span>
              <i className="cloudops-sw credit" />
              Covered by credits
            </span>
          )}
          {prevAvg !== null && (
            <span>
              <i className="cloudops-sw ref" />
              {shortMonth(report.period.last_month_start)} average
            </span>
          )}
        </div>
        <span className="shell-spacer" />
        <button type="button" className="cloudops-toggle" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No daily spend to chart yet.</p>
      ) : asTable ? (
        <div className="cloudops-scroll">
          <table className="cloudops-table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Charges</th>
                <th className="num">Credits</th>
                <th className="num">We pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <td>{dayLabel(r.date)}</td>
                  <td className="num">{usd(r.usage)}</td>
                  <td className="num">{r.credit ? `−${usd(r.credit)}` : "—"}</td>
                  <td className="num">{usd(r.pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cloudops-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily charges, split into what we pay and what credits covered">
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={L} x2={W - R} y1={yOf(t)} y2={yOf(t)} />
                <text x={L - 8} y={yOf(t) + 3.5} textAnchor="end">
                  ${t}
                </text>
              </g>
            ))}
            {[1, 8, 15, 22, 29].filter((d) => d <= daysInMonth).map((d) => (
              <text key={d} x={L + (d - 0.5) * slot} y={H - 6} textAnchor="middle">
                {d} {shortMonth(report.period.month_start).slice(0, 3)}
              </text>
            ))}
            {rows.map((r, i) => {
              const day = Number(r.date.slice(8, 10));
              const x = L + (day - 1) * slot + (slot - bw) / 2;
              const y0 = yOf(0), yCredit = yOf(r.credit), yTop = yOf(r.usage);
              const gap = r.credit > 0 && r.pay > 0 ? 2 : 0;
              const dim = hover !== null && hover !== i;
              return (
                <g key={r.date} className={dim ? "day dim" : "day"}>
                  {r.credit > 0 && <rect className="credit" x={x} width={bw} y={yCredit} height={Math.max(0, y0 - yCredit)} rx={r.pay > 0 ? 0 : 3} />}
                  {r.pay > 0 && <rect className="pay" x={x} width={bw} y={yTop} height={Math.max(0, yCredit - gap - yTop)} rx={3} />}
                  <rect className="hit" x={L + (day - 1) * slot} width={slot} y={T} height={plotH} onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
            {prevAvg !== null && (
              <g>
                <line className="ref" x1={L} x2={W - R} y1={yOf(prevAvg)} y2={yOf(prevAvg)} />
                <text className="ref-label" x={W - R} y={yOf(prevAvg) - 5} textAnchor="end">
                  {shortMonth(report.period.last_month_start).slice(0, 3)} avg {usd(prevAvg)}/day
                </text>
              </g>
            )}
          </svg>
          {hovered && (
            <div className="cloudops-tip" style={{ left: `${Math.min(80, (Number(hovered.date.slice(8, 10)) / daysInMonth) * 100)}%` }}>
              <div className="t">{dayLabel(hovered.date)}</div>
              <div className="r">
                Charges <b>{usd(hovered.usage)}</b>
              </div>
              {hovered.credit > 0 && (
                <div className="r">
                  Credits <b>−{usd(hovered.credit)}</b>
                </div>
              )}
              <div className="r">
                We pay <b>{usd(hovered.pay)}</b>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type Tab = "service" | "app" | "environment";

function ShareRows({ rows, lastMonth, lastLabel }: { rows: NamedAmount[]; lastMonth?: Record<string, number> | null; lastLabel: string }) {
  const total = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  const biggest = Math.max(0, ...rows.map((r) => r.amount));
  return (
    <table className="cloudops-table">
      <thead>
        <tr>
          <th>Name</th>
          <th className="num">Amount</th>
          <th>Share</th>
          {lastMonth && <th className="num">{lastLabel}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td className="num">{usd(r.amount)}</td>
            <td>
              <div className="cloudops-share">
                <div className="cloudops-share-track">
                  <div className="cloudops-share-bar" style={{ width: `${biggest > 0 ? (Math.max(0, r.amount) / biggest) * 100 : 0}%` }} />
                </div>
                <span>{share(r.amount, total)}</span>
              </div>
            </td>
            {lastMonth && <td className="num muted">{r.name in lastMonth ? usd(lastMonth[r.name]) : "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WhereItGoes({ report }: { report: CostReport }) {
  const [tab, setTab] = useState<Tab>("service");
  const lastLabel = shortMonth(report.period.last_month_start);
  const services = report.by_service.map((r) => ({ ...r, aws: r.name, name: serviceName(r.name) }));
  const lastByService = report.last_by_service
    ? Object.fromEntries(services.map((s) => [s.name, report.last_by_service?.[s.aws] ?? 0]).filter(([, v]) => v !== 0))
    : null;
  const byApp = report.by_app;
  const appTotal = (byApp ?? []).reduce((s, r) => s + Math.max(0, r.amount), 0);
  const untagged = byApp?.find((r) => r.name === "untagged")?.amount ?? 0;
  const free = report.free_services ?? [];
  const rows: NamedAmount[] | null = tab === "service" ? services : tab === "app" ? byApp : report.by_environment;

  return (
    <section className="cloudops-card" aria-label="Where it goes">
      <div className="cloudops-card-head">
        <h2>Where it goes</h2>
        <div className="cloudops-seg" role="group" aria-label="Group by">
          {(
            [
              ["service", "By service"],
              ["app", "By app"],
              ["environment", "By environment"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </div>
        {tab === "app" && appTotal > 0 && untagged / appTotal >= 0.05 && (
          <span className="cloudops-chip-warn">{share(untagged, appTotal)} untagged</span>
        )}
      </div>
      {rows === null ? (
        <p className="muted">Not available yet.</p>
      ) : rows.length === 0 ? (
        <p className="muted">No spend recorded this month.</p>
      ) : (
        <div className="cloudops-scroll">
          <ShareRows rows={rows} lastMonth={tab === "service" ? lastByService : null} lastLabel={lastLabel} />
        </div>
      )}
      {tab === "service" && free.length > 0 && (
        <p className="cloudops-free" data-testid="free-services">
          <span className="cloudops-free-label">Free this month</span>
          {free.map((s) => (s === "AWS Lambda" && report.lambda ? `Lambda (${count(report.lambda.requests)} runs)` : serviceName(s))).join(" · ")}
        </p>
      )}
    </section>
  );
}

function RecentMonths({ report, past }: { report: CostReport; past: boolean }) {
  const history = report.history;
  if (!history || history.length < 2) return null;
  return (
    <section className="cloudops-card" aria-label="Recent months">
      <div className="cloudops-card-head">
        <h2>Recent months</h2>
      </div>
      <table className="cloudops-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Charges</th>
            <th className="num">Credits</th>
            <th className="num">We pay</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => (
            <tr key={h.month_start}>
              <td>
                {shortMonth(h.month_start)}
                {i === 0 && !past && <span className="muted"> so far</span>}
              </td>
              <td className="num">{usd(h.usage)}</td>
              <td className="num">{h.credits ? `−${credited(h.credits)}` : "—"}</td>
              <td className="num">
                <b>{usd(h.before_vat)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Report({ report }: { report: CostReport }) {
  const past = report.period.complete === true; // a finished month: nothing left to forecast
  const ended = report.credits_ended;
  return (
    <>
      {ended && (
        <div className="cloudops-alert" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 2 21h20L12 3z" />
            <path d="M12 10v5M12 18v.5" />
          </svg>
          <span>
            <b>Free credits ran out on {dayLabel(ended)}.</b> We now pay the whole bill.
          </span>
        </div>
      )}
      <KeyFigures report={report} past={past} />
      <DailyChart report={report} />
      <div className="cloudops-split">
        <WhereItGoes report={report} />
        <RecentMonths report={report} past={past} />
      </div>
      {report.notes.length > 0 && (
        <ul className="muted cloudops-notes">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Everything the page shows, from data alone, so it can be rendered and tested without a server. */
export function CostsView({
  data,
  loading,
  refreshing,
  error,
  onRefresh,
  month = "",
  onMonth,
  months = monthOptions(),
}: {
  data: CostsResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  /** "" is this month, otherwise "YYYY-MM". */
  month?: string;
  onMonth?: (month: string) => void;
  months?: { value: string; label: string }[];
}) {
  const snapshot: CostSnapshot | null = data?.snapshot ?? null;
  const enabled = data?.enabled ?? true;
  return (
    <div className="page stack cloudops-costs">
      <div className="cloudops-head">
        <h1>Costs</h1>
        {snapshot && (
          <span className="cloudops-stamp" data-testid="last-refreshed">
            Refreshed {formatDateTime(snapshot.created_at)}
            {snapshot.created_by ? ` · ${snapshot.created_by}` : ""}
          </span>
        )}
        <span className="shell-spacer" />
        {enabled && onMonth && (
          <select className="input cloudops-month" aria-label="Month" value={month} onChange={(e) => onMonth(e.target.value)} disabled={refreshing}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <button className="btn primary" onClick={onRefresh} disabled={loading || refreshing || !enabled}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="status-banner warn">{error}</div>}
      {data && !enabled && (
        <div className="status-banner warn">CloudOps is switched off in this environment. It runs in production only.</div>
      )}
      {enabled && data && !snapshot && (
        <div className="empty">
          <p>
            {refreshing
              ? "Fetching the AWS bill…"
              : month
                ? `No report for ${months.find((m) => m.value === month)?.label ?? month} yet.`
                : "No report yet."}
          </p>
        </div>
      )}
      {snapshot && <Report report={snapshot.report} />}
    </div>
  );
}

export function CloudOpsCostsPage() {
  const [month, setMonth] = useState(""); // "" is this month
  const costs = useLoad(() => getCosts(month || undefined), [month]);
  const [fresh, setFresh] = useState<{ month: string; data: CostsResponse } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picking a month nobody has fetched yet fetches it, once. A month that already has a saved report just
  // opens it (free), and a failed fetch is not retried on its own.
  const picked = useRef(false);
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const d = costs.data;
    if (!picked.current || costs.loading || refreshing || !d || !d.enabled || d.snapshot || tried.current.has(month)) return;
    tried.current.add(month);
    void onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costs.loading, costs.data, month]);

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      setFresh({ month, data: await refreshCosts(month || undefined) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <CostsView
      data={fresh && fresh.month === month ? fresh.data : costs.loading ? null : costs.data} // never show the last month picked while the next loads
      loading={costs.loading}
      refreshing={refreshing}
      error={error ?? costs.error}
      onRefresh={onRefresh}
      month={month}
      onMonth={(m) => {
        setError(null);
        picked.current = true;
        setMonth(m);
      }}
    />
  );
}
