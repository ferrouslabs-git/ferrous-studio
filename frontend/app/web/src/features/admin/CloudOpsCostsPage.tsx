// Super admin: the AWS bill so far, by app and by AWS service (INT-REQ-14, phase 1).
// Opening this page reads the last saved report and asks AWS nothing. "Refresh report" is the only thing
// that calls Cost Explorer (a few cents), and the server saves what it gets for next time.
import { ReactNode, useState } from "react";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import { CostReport, CostSnapshot, CostsResponse, DailyAmount, NamedAmount, Totals, getCosts, refreshCosts } from "./cloudopsApi";
import { barHeights, dayLabel, peak, share, usd } from "./cloudopsFormat";

function Card({ title, totals, children }: { title: string; totals?: Totals; children?: ReactNode }) {
  return (
    <section className="cloudops-card" aria-label={title}>
      <h2>{title}</h2>
      {totals && (
        <dl className="cloudops-lines">
          <dt>Usage, before credits</dt>
          <dd>{usd(totals.usage)}</dd>
          <dt>Credits</dt>
          <dd>{usd(totals.credits)}</dd>
          <dt className="strong">Before VAT</dt>
          <dd className="strong">{usd(totals.before_vat)}</dd>
          <dt>VAT</dt>
          <dd>{usd(totals.vat)}</dd>
          <dt>With VAT</dt>
          <dd>{usd(totals.with_vat)}</dd>
          <dt>Effective, VAT reclaimed</dt>
          <dd>{usd(totals.effective)}</dd>
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
function Daily({ current, previous }: { current: DailyAmount[]; previous: DailyAmount[] }) {
  const max = peak(current, previous);
  const rows: [string, DailyAmount[]][] = [
    ["This month", current],
    ["Last month", previous],
  ];
  return (
    <section className="cloudops-section" aria-label="Daily cost">
      <h2>Daily cost</h2>
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
                    className={label === "This month" ? "bar current" : "bar previous"}
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
  return (
    <>
      <div className="cloudops-cards">
        <Card title="Month to date" totals={report.month_to_date} />
        <Card title="Forecast for the month">
          {f ? (
            <dl className="cloudops-lines">
              {f.at_current_pace && (
                <>
                  <dt className="strong">At the last {f.at_current_pace.days} days’ pace</dt>
                  <dd className="strong">{usd(f.at_current_pace.month_usage)}</dd>
                  <dt className="muted">That pace</dt>
                  <dd className="muted">{usd(f.at_current_pace.per_day)} a day</dd>
                </>
              )}
              {f.month_usage !== null && f.remaining !== null && (
                <>
                  <dt>AWS’s own forecast</dt>
                  <dd>{usd(f.month_usage)}</dd>
                  <dt className="muted">Still to come, per AWS</dt>
                  <dd className="muted">{usd(f.remaining)}</dd>
                </>
              )}
              <dt className="muted" style={{ gridColumn: "1 / -1" }}>
                Month-end usage, {f.basis}. AWS’s model can run well above what is actually being spent.
              </dt>
            </dl>
          ) : (
            <p className="muted">No forecast available (AWS needs more history, or it is the last day of the month).</p>
          )}
        </Card>
        <Card title="Last month" totals={report.last_month} />
      </div>

      <Breakdown
        title="By app (from the Product tag)"
        rows={report.by_app}
        note="Spend before the tag was activated, and anything without a tag, appears as “untagged”."
      />
      <Breakdown title="By environment (from the Environment tag)" rows={report.by_environment} />
      <Breakdown title="By AWS service" rows={report.by_service} note="Usage before credits and VAT." />
      <Daily current={report.daily} previous={report.daily_previous} />

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
}: {
  data: CostsResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const snapshot: CostSnapshot | null = data?.snapshot ?? null;
  const enabled = data?.enabled ?? true;
  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Costs</h1>
        <span className="shell-spacer" />
        <button className="btn primary" onClick={onRefresh} disabled={loading || refreshing || !enabled}>
          {refreshing ? "Refreshing…" : "Refresh report"}
        </button>
      </div>

      {snapshot ? (
        <p className="muted" data-testid="last-refreshed">
          Last refreshed {formatDateTime(snapshot.created_at)}
          {snapshot.created_by ? ` by ${snapshot.created_by}` : ""}. Opening this page does not call AWS; refreshing costs a few cents.
        </p>
      ) : (
        enabled && data && <p className="muted">Not refreshed yet.</p>
      )}

      {error && <div className="status-banner warn">{error}</div>}
      {data && !enabled && (
        <div className="status-banner warn">CloudOps is switched off in this environment. It runs in production only.</div>
      )}
      {enabled && data && !snapshot && (
        <div className="empty">
          <p>No report yet.</p>
          <p className="empty-hint">Press “Refresh report” to fetch the AWS bill. It costs a few cents and is saved for next time.</p>
        </div>
      )}
      {snapshot && <Report report={snapshot.report} />}
    </div>
  );
}

export function CloudOpsCostsPage() {
  const costs = useLoad(getCosts, []);
  const [fresh, setFresh] = useState<CostsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      setFresh(await refreshCosts());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <CostsView
      data={fresh ?? costs.data}
      loading={costs.loading}
      refreshing={refreshing}
      error={error ?? costs.error}
      onRefresh={onRefresh}
    />
  );
}
