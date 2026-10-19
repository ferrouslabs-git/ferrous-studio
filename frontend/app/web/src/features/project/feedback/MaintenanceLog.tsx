// Feedback > Maintenance log (FS-REQ-54): the contracts the client has bought
// support hours under, and how those hours have been spent month by month on
// the reports resolved against them.
//
// Contracts are dated rows, never one editable figure: the agreement changes
// over time, and a month already gone keeps the hours it was sold with. The
// arithmetic -- what each month provided, used, rolled over and left -- is
// maintenance.ts's, from these rows and the report list the page already holds.
import { FormEvent, useMemo, useState } from "react";
import { Confirmation, ConfirmationDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import {
  createMaintenanceContract,
  deleteMaintenanceContract,
  Feedback,
  listMaintenanceContracts,
  MaintenanceContract,
  MaintenanceContractInput,
  updateMaintenanceContract,
} from "./feedbackApi";
import { chargedWork, currentMonth, fmtDay, fmtHours, fmtMonth, maintenanceLedger, monthOf, MonthRow, RaisedRequirement } from "./maintenance";

type Phase = "current" | "upcoming" | "ended";

const PHASE_LABEL: Record<Phase, string> = { current: "Current", upcoming: "Not started", ended: "Ended" };
const PHASE_BADGE: Record<Phase, string> = { current: "good", upcoming: "accent", ended: "muted" };

function phaseOf(c: MaintenanceContract, month: string): Phase {
  if (monthOf(c.start_date) > month) return "upcoming";
  if (c.end_date !== null && monthOf(c.end_date) < month) return "ended";
  return "current";
}

const EMPTY_FORM = { start_date: "", end_date: "", hours_per_month: "" };

export function MaintenanceLog({
  projectId,
  reports,
  requirements,
  canWrite,
  creating,
}: {
  projectId: string;
  /** Every report on the board; only resolved ones count. */
  reports: Feedback[];
  /** The board's requirements: those raised from a report replace its
   *  estimate with theirs (chargedWork). */
  requirements: RaisedRequirement[];
  canWrite: boolean;
  /** Bumped by the page head's "Add contract" to open the form. */
  creating: number;
}) {
  const contracts = useLoad(() => listMaintenanceContracts(projectId), [projectId]);
  const month = currentMonth();

  const [editing, setEditing] = useState<MaintenanceContract | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<Confirmation | null>(null);
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");

  // The page head's button lives outside this component; a changed counter
  // is its click. Compared against the last one seen so a re-render never
  // re-opens a form the user has closed.
  const [seenCreate, setSeenCreate] = useState(creating);
  if (creating !== seenCreate) {
    setSeenCreate(creating);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDrawerOpen(true);
  }

  const openEdit = (c: MaintenanceContract) => {
    setEditing(c);
    setForm({ start_date: c.start_date, end_date: c.end_date ?? "", hours_per_month: String(c.hours_per_month) });
    setFormError(null);
    setDrawerOpen(true);
  };

  const list = contracts.data ?? [];
  const ledger = useMemo(
    () => maintenanceLedger(list, chargedWork(reports, requirements), month),
    [list, reports, requirements, month],
  );
  const thisMonth: MonthRow | undefined = ledger[ledger.length - 1];
  const months = useMemo(() => [...ledger].reverse(), [ledger]);

  const visible = useMemo(
    () =>
      list.filter(
        (c) =>
          (!phaseFilter || phaseOf(c, month) === phaseFilter) &&
          matches(query, fmtDay(c.start_date), c.end_date ? fmtDay(c.end_date) : "", String(c.hours_per_month)),
      ),
    [list, phaseFilter, query, month],
  );

  const hours = Number(form.hours_per_month);
  const valid =
    form.start_date !== "" &&
    form.hours_per_month.trim() !== "" &&
    Number.isFinite(hours) &&
    hours >= 0 &&
    (form.end_date === "" || form.end_date >= form.start_date);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setFormError(null);
    const body: MaintenanceContractInput = {
      start_date: form.start_date,
      end_date: form.end_date || null,
      hours_per_month: hours,
    };
    try {
      if (editing) await updateMaintenanceContract(projectId, editing.id, body);
      else await createMaintenanceContract(projectId, body);
      setDrawerOpen(false);
      await contracts.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const period = (c: MaintenanceContract) => `${fmtDay(c.start_date)} – ${c.end_date ? fmtDay(c.end_date) : "open-ended"}`;

  return (
    <>
      <div className="card-grid maint-grid">
        <Figure label="Contracted this month" value={thisMonth?.contracted ?? 0} />
        <Figure label="Used this month" value={thisMonth?.used ?? 0} />
        <Figure label="Rolled over" value={thisMonth?.rolledOver ?? 0} />
        <Figure label="Current balance" value={thisMonth?.balance ?? 0} />
      </div>
      {thisMonth && thisMonth.unestimated > 0 && (
        <div className="status-banner warn">
          {thisMonth.unestimated} report{thisMonth.unestimated === 1 ? " was" : "s were"} resolved this month without
          an estimate and used no hours.
        </div>
      )}

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search contracts", label: "Search contracts" }}
        filters={[
          {
            label: "Filter by period",
            value: phaseFilter,
            onChange: setPhaseFilter,
            options: [
              { value: "", label: "All contracts" },
              ...(Object.keys(PHASE_LABEL) as Phase[]).map((p) => ({ value: p, label: PHASE_LABEL[p] })),
            ],
          },
        ]}
        count={{ visible: visible.length, total: list.length, noun: ["contract", "contracts"] }}
      />
      <ListTable
        title="Contracts"
        columns={[
          {
            header: "Period",
            className: "primary",
            render: (c) => <span className="name">{period(c)}</span>,
          },
          { header: "Hours per month", className: "num", render: (c) => fmtHours(c.hours_per_month) },
          {
            header: "Status",
            render: (c) => {
              const p = phaseOf(c, month);
              return <span className={`badge ${PHASE_BADGE[p]}`}>{PHASE_LABEL[p]}</span>;
            },
          },
        ]}
        rows={visible}
        rowKey={(c) => c.id}
        rowLabel={period}
        actions={(c) =>
          canWrite
            ? [
                { label: "Edit", onSelect: () => openEdit(c) },
                {
                  label: "Delete",
                  danger: true,
                  onSelect: () =>
                    setPending({
                      title: "Delete contract",
                      body: (
                        <p>
                          Delete the contract for <b>{period(c)}</b>? The months it covered will lose its hours.
                        </p>
                      ),
                      run: async () => {
                        await deleteMaintenanceContract(projectId, c.id);
                        await contracts.reload();
                      },
                    }),
                },
              ]
            : null
        }
        loading={contracts.loading}
        error={contracts.error}
        empty={list.length ? "No contracts match these filters." : <b>No maintenance contracts yet.</b>}
      />

      <ListTable
        title="By month"
        columns={[
          { header: "Month", className: "primary", render: (r) => <span className="name">{fmtMonth(r.month)}</span> },
          { header: "Contracted", className: "num", render: (r) => fmtHours(r.contracted) },
          { header: "Rolled over", className: "num", render: (r) => fmtHours(r.rolledOver) },
          {
            header: "Used",
            className: "num",
            render: (r) => (
              <>
                {fmtHours(r.used)}
                {r.unestimated > 0 && (
                  <span className="badge warn" title={`${r.unestimated} resolved without an estimate`}>
                    {r.unestimated} unestimated
                  </span>
                )}
              </>
            ),
          },
          {
            header: "Balance",
            className: "num",
            render: (r) => <span className={r.balance < 0 ? "maint-neg" : undefined}>{fmtHours(r.balance)}</span>,
          },
          { header: "Resolved", className: "num", render: (r) => r.resolved },
        ]}
        rows={months}
        rowKey={(r) => r.month}
        loading={contracts.loading}
        error={contracts.error}
        empty="Months appear here once a contract has started."
      />

      <Drawer
        open={drawerOpen}
        title={editing ? "Edit contract" : "Add contract"}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        width={420}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !valid}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add contract"}
            </button>
          </>
        }
      >
        <Field label="Start date">
          <input
            className="input"
            type="date"
            required
            value={form.start_date}
            onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
          />
        </Field>
        <Field label="End date (optional)">
          <input
            className="input"
            type="date"
            min={form.start_date || undefined}
            value={form.end_date}
            onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
          />
        </Field>
        <Field label="Hours per month">
          <input
            className="input"
            type="number"
            min={0}
            step={0.5}
            required
            value={form.hours_per_month}
            onChange={(e) => setForm((f) => ({ ...f, hours_per_month: e.target.value }))}
          />
        </Field>
        {form.end_date !== "" && form.start_date !== "" && form.end_date < form.start_date && (
          <div className="status-banner warn">The end date is before the start date.</div>
        )}
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmationDrawer pending={pending} onClose={() => setPending(null)} />
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="card maint-card">
      <h3>{label}</h3>
      <p className={`maint-figure${value < 0 ? " maint-neg" : ""}`}>{fmtHours(value)}</p>
    </div>
  );
}
