// Super admin: the AWS bill so far, by app and by AWS service (INT-REQ-14, phase 1).
// Opening this page reads the last saved report and asks AWS nothing. "Refresh report" is the only thing
// that calls Cost Explorer (a few cents), and the server saves what it gets for next time.
import { ReactNode, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import { CostReport, CostSnapshot, CostsResponse, DailyAmount, NamedAmount, Totals, getCosts, refreshCosts } from "./cloudopsApi";
import { barHeights, dayLabel, monthName, monthOptions, peak, share, usd } from "./cloudopsFormat";

function Card({ title, totals, children }: { title: string; totals?: Totals; children?: ReactNode }) {
  return (
    <section className="cloudops-card" aria-label={title}>
      <h2>{title}</h2>
      {totals && (
        <dl className="cloudops-lines">
          <dt>AWS charges</dt>
          <dd>{usd(totals.usage)}</dd>
          <dt>Free credits used</dt>
          <dd>{usd(totals.credits)}</dd>
          <dt className="strong">We pay</dt>
          <dd className="strong">{usd(totals.before_vat)}</dd>
          <dt className="muted">VAT on top (reclaimed later)</dt>
          <dd className="muted">{usd(totals.vat)}</dd>
          <dt className="muted">Card is charged</dt>
          <dd className="muted">{usd(totals.with_vat)}</dd>
        </dl>
      )}
      {children}
    </section>
  );
}

function Breakdown({ title, rows, note }: { title: string; rows: NamedAmount[] | null; note?: string }) {
  const total = (rows ?? []).reduce((sum, r) => sum + Math.max(0, r.amount), 0);
  return (
    <section className="cloudops-section" aria-label={title}>
      <h2>{title}</h2>
      {rows === null ? (
        <p className="muted">Not available yet.</p>
      ) : rows.length === 0 ? (
        <p className="muted">No spend recorded this month.</p>
      ) : (
        <table className="data-table list-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Amount</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{usd(r.amount)}</td>
                <td className="num">{share(r.amount, total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="muted cloudops-note">{note}</p>}
    </section>
  );
}

/** A plain SVG bar chart of daily spend, this month in colour and last month beneath it, both on one scale. */
function Daily({ current, previous, labels }: { current: DailyAmount[]; previous: DailyAmount[]; labels: [string, string] }) {
  const max = peak(current, previous);
  const rows: [string, DailyAmount[]][] = [
    [labels[0], current],
    [labels[1], previous],
  ];
  return (
    <section className="cloudops-section" aria-label="Daily cost">
      <h2>Cost per day</h2>
      {max === 0 ? (
        <p className="muted">No daily spend to chart yet.</p>
      ) : (
        rows.map(([label, series]) => {
          const heights = barHeights(series, max);
          return (
            <figure key={label} className="cloudops-chart">
              <figcaption>
                {label} <span className="muted">(busiest day {usd(Math.max(0, ...series.map((d) => d.amount)))})</span>
              </figcaption>
              <svg viewBox={`0 0 ${Math.max(series.length, 1) * 10} 60`} preserveAspectRatio="none" role="img" aria-label={`${label}: daily AWS cost`}>
                {series.map((d, i) => (
                  <rect
                    key={d.date}
                    className={label === labels[0] ? "bar current" : "bar previous"}
                    x={i * 10 + 1}
                    width={8}
                    y={60 - heights[i] * 58}
                    height={heights[i] * 58}
                  >
                    <title>{`${dayLabel(d.date)}: ${usd(d.amount)}`}</title>
                  </rect>
                ))}
              </svg>
            </figure>
          );
        })
      )}
    </section>
  );
}

function Report({ report }: { report: CostReport }) {
  const f = report.forecast;
  const past = report.period.complete === true; // a finished month: nothing left to forecast
  const thisName = past ? monthName(report.period.month_start) : "This month";
  const beforeName = past ? monthName(report.period.last_month_start) : "Last month";
  return (
    <>
      <div className="cloudops-cards">
        <Card title={past ? thisName : "This month so far"} totals={report.month_to_date} />
        {!past && <Card title="Expected by the end of the month">
          {f ? (
            <dl className="cloudops-lines">
              {f.at_current_pace && (
                <>
                  <dt className="strong">If spending stays like the last {f.at_current_pace.days} days</dt>
                  <dd className="strong">{usd(f.at_current_pace.month_usage)}</dd>
                  <dt className="muted">That is about</dt>
                  <dd className="muted">{usd(f.at_current_pace.per_day)} a day</dd>
                </>
              )}
              {f.month_usage !== null && f.remaining !== null && (
                <>
                  <dt>AWS’s own guess</dt>
                  <dd>{usd(f.month_usage)}</dd>
                  <dt className="muted">Still to come, by AWS’s guess</dt>
                  <dd className="muted">{usd(f.remaining)}</dd>
                </>
              )}
              <dt className="muted" style={{ gridColumn: "1 / -1" }}>
                These are AWS charges before credits and VAT. AWS’s own guess is often too high, so trust the first line.
              </dt>
            </dl>
          ) : (
            <p className="muted">No forecast available (AWS needs more history, or it is the last day of the month).</p>
          )}
        </Card>}
        <Card title={beforeName} totals={report.last_month} />
      </div>

      <Breakdown
        title="Cost by app"
        rows={report.by_app}
        note="“untagged” is spend AWS could not match to an app. Tags only count from the day they were switched on, so most of this month is untagged for now. It shrinks each day."
      />
      <Breakdown title="Cost by environment (staging, prod…)" rows={report.by_environment} />
      <Breakdown title="Cost by AWS service (what kind of thing we pay for)" rows={report.by_service} note="AWS charges before credits and VAT." />
      <Daily current={report.daily} previous={report.daily_previous} labels={[thisName, beforeName]} />

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
    <div className="page stack">
      <div className="page-head">
        <h1>Costs</h1>
        <span className="shell-spacer" />
        {enabled && onMonth && (
          <select aria-label="Month" value={month} onChange={(e) => onMonth(e.target.value)} disabled={refreshing}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <button className="btn primary" onClick={onRefresh} disabled={loading || refreshing || !enabled}>
          {refreshing ? "Refreshing…" : "Refresh report"}
        </button>
      </div>

      <p className="muted">What AWS is charging us for Ferrous and its apps. Free credits reduce what we actually pay.</p>

      {snapshot ? (
        <p className="muted" data-testid="last-refreshed">
          Last refreshed {formatDateTime(snapshot.created_at)}
          {snapshot.created_by ? ` by ${snapshot.created_by}` : ""}. Opening this page does not call AWS; refreshing costs a few cents.
        </p>
      ) : (
        enabled && data && !loading && <p className="muted">Not refreshed yet.</p>
      )}

      {error && <div className="status-banner warn">{error}</div>}
      {data && !enabled && (
        <div className="status-banner warn">CloudOps is switched off in this environment. It runs in production only.</div>
      )}
      {enabled && data && !snapshot && (
        <div className="empty">
          {refreshing ? (
            <p>Fetching the AWS bill…</p>
          ) : (
            <>
              <p>{month ? `No report for ${months.find((m) => m.value === month)?.label ?? month} yet.` : "No report yet."}</p>
              <p className="empty-hint">Press “Refresh report” to fetch the AWS bill. It costs a few cents and is saved for next time.</p>
            </>
          )}
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
