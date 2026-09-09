// Feedback: the deployed environments this project can be reached at, and
// what people found when they went there.
//
// This is the one delivery section an organisation *member* can write to. They
// raise reports; only an admin triages, corrects or deletes one, so the page
// has two readings of the same table -- see `canWrite` versus
// `canRaiseFeedback` below. Both come from ProjectLayout, and neither is
// narrowed by a locked version: an environment stays live whatever a frozen
// design version says, and freezing v1 must not silence the people testing it.
import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../../app/session";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatDateTime } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { ScreenshotField, ScreenshotItem } from "../../screenshot/ScreenshotField";
import { listAttachments, loadAttachmentBitmap } from "../attachmentsApi";
import { useProject } from "../ProjectLayout";
import {
  createFeedback,
  deleteFeedback,
  Environment,
  Feedback,
  FeedbackInput,
  FeedbackKind,
  FeedbackSeverity,
  FeedbackStatus,
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  KIND_LABELS,
  SEVERITY_LABELS,
  listEnvironments,
  listFeedback,
  updateFeedback,
  uploadFeedbackScreenshots,
} from "./feedbackApi";

const EMPTY: FeedbackInput = {
  environment: "uat",
  kind: "feedback",
  severity: "medium",
  title: "",
  detail: "",
  page_url: "",
};

/** A report that has been dealt with is not news; one that has not is. */
const STATUS_BADGE: Record<FeedbackStatus, string> = {
  New: "accent",
  Triaged: "warn",
  Accepted: "good",
  Declined: "muted",
  Done: "muted",
};

const KIND_BADGE: Record<FeedbackKind, string> = {
  feedback: "muted",
  bug: "warn",
  requirement: "accent",
};

/** Only the top of the scale is coloured. If every severity shouted, a queue
 *  of them would read as flat as no severity at all. */
const SEVERITY_BADGE: Record<FeedbackSeverity, string> = {
  low: "muted",
  medium: "muted",
  high: "warn",
  critical: "accent",
};

/**
 * The list opens as a triage queue rather than as a full record: what has been
 * accepted or turned down has already had its decision, and leaving it in the
 * default view buries the reports still waiting for one. Clearing the filter
 * (the toolbar's Clear, or picking "All statuses") shows everything.
 */
const OPEN_ONLY = "open";
const DEFAULT_STATUS_FILTER = OPEN_ONLY;

function inStatusFilter(item: Feedback, filter: string): boolean {
  if (filter === "") return true;
  if (filter === OPEN_ONLY) return item.status !== "Declined" && item.status !== "Done";
  return item.status === filter;
}

export function FeedbackPage() {
  const { project, orgId, canWrite, canRaiseFeedback } = useProject();
  // The organisation role, not the lock-narrowed one: addresses are set on the
  // project details page, which stays open on a frozen version (see
  // EnvironmentsSection). Only used to decide whether an unpublished
  // environment is worth offering a way in to.
  const { canWrite: canPublish } = useSession();
  const environments = useLoad(() => listEnvironments(project.id), [project.id]);
  const reports = useLoad(() => listFeedback(project.id), [project.id]);

  const [editing, setEditing] = useState<Feedback | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Feedback | null>(null);
  const [form, setForm] = useState<FeedbackInput>(EMPTY);
  const [status, setStatus] = useState<FeedbackStatus>("New");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Screenshots waiting to be attached. A new report cannot own them until it
  // exists (the server checks the target before it will presign), so they queue
  // here and go up straight after create; an existing report uploads on the
  // spot. `raised` remembers which report a partial failure belongs to, so
  // Retry knows where to send them.
  const [shots, setShots] = useState<ScreenshotItem[]>([]);
  const [raised, setRaised] = useState<Feedback | null>(null);

  // Whether the reporter has edited the page address themselves. Until they
  // have, it follows the chosen environment; afterwards it is theirs, and
  // correcting the environment dropdown must not wipe a pasted path.
  const [urlTouched, setUrlTouched] = useState(false);

  const [query, setQuery] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER);

  const envs = environments.data ?? [];
  const labelOf = useMemo(() => new Map(envs.map((e) => [e.slug, e.label])), [envs]);
  const patch = (p: Partial<FeedbackInput>) => setForm((f) => ({ ...f, ...p }));

  /** The published address of an environment, "" when it has none. */
  const addressOf = (slug: string) => envs.find((e) => e.slug === slug)?.url ?? "";

  const openDrawer = (item: Feedback | null) => {
    setEditing(item);
    setForm(
      item
        ? {
            environment: item.environment,
            kind: item.kind,
            severity: item.severity,
            title: item.title,
            detail: item.detail,
            page_url: item.page_url,
          }
        : { ...EMPTY, page_url: addressOf(EMPTY.environment) },
    );
    setUrlTouched(item !== null && item.page_url !== "");
    setStatus(item?.status ?? "New");
    setFormError(null);
    for (const shot of shots) shot.bitmap.close();
    setShots([]);
    setRaised(null);
    setDrawerOpen(true);
    // Screenshots already on the report arrive as items that are already
    // "done", so the field renders saved and unsaved ones the same way and
    // uploadFeedbackScreenshots skips them.
    if (item) void loadSaved(item.id);
  };

  const loadSaved = async (feedbackId: string) => {
    try {
      const attachments = await listAttachments(project.id, "feedback", feedbackId);
      for (const attachment of attachments) {
        const { blob, bitmap } = await loadAttachmentBitmap(project.id, attachment.id);
        setShots((current) =>
          current.some((s) => s.id === attachment.id)
            ? current
            : [
                ...current,
                {
                  id: attachment.id,
                  file: new File([blob], attachment.filename, { type: attachment.content_type }),
                  bitmap,
                  status: "done",
                },
              ],
        );
      }
    } catch {
      /* a screenshot that will not load must not stop the report opening */
    }
  };

  /** Changing environment re-seeds the address, until the reporter owns it. */
  const pickEnvironment = (slug: FeedbackInput["environment"]) =>
    patch(urlTouched ? { environment: slug } : { environment: slug, page_url: addressOf(slug) });

  // A member may raise a report but not touch one afterwards, so the drawer
  // doubles as a reader: same fields, nothing enabled, no Save.
  const readOnly = editing !== null && !canWrite;

  /**
   * Send the queued screenshots to a report that now exists.
   *
   * The report is never rolled back on a failure here: a member cannot delete
   * one, and the words they wrote are worth more than the picture. So a partial
   * failure keeps the drawer open, says what happened, and offers Retry --
   * which is safe to press repeatedly, since each attempt mints a fresh
   * attachment row and an abandoned one is never listed.
   */
  const sendShots = async (report: Feedback, queue: ScreenshotItem[]) => {
    const { failed } = await uploadFeedbackScreenshots(
      project.id,
      report.id,
      queue.map((s) => ({ id: s.id, file: s.file, status: s.status === "done" ? "done" : "queued" })),
      (next) =>
        setShots((current) =>
          current.map((item) => {
            const update = next.find((n) => n.id === item.id);
            return update ? { ...item, status: update.status, error: update.error } : item;
          }),
        ),
    );
    return failed;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body = {
      ...form,
      title: form.title.trim(),
      detail: form.detail.trim(),
      page_url: form.page_url.trim(),
    };
    try {
      const report = editing
        ? await updateFeedback(project.id, editing.id, { ...body, status })
        : await createFeedback(project.id, body);

      const pending = shots.filter((s) => s.status !== "done");
      if (pending.length === 0) {
        setDrawerOpen(false);
        await reports.reload();
        return;
      }

      const failed = await sendShots(report, pending);
      await reports.reload();
      if (failed === 0) {
        setDrawerOpen(false);
        return;
      }
      // Stay open so the evidence can be retried against the report that now
      // exists -- and say plainly that the report itself did land.
      setRaised(report);
      setFormError(
        `${report.human_id} was raised, but ${failed} of ${pending.length} screenshots did not upload.`,
      );
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const retryShots = async () => {
    if (!raised) return;
    setSaving(true);
    const failed = await sendShots(raised, shots.filter((s) => s.status !== "done"));
    setSaving(false);
    if (failed === 0) {
      setFormError(null);
      setDrawerOpen(false);
      await reports.reload();
    } else {
      setFormError(`${failed} screenshot${failed === 1 ? "" : "s"} still did not upload.`);
    }
  };

  const rows = reports.data ?? [];
  const visible = useMemo(
    () =>
      rows.filter(
        (item) =>
          (!envFilter || item.environment === envFilter) &&
          (!kindFilter || item.kind === kindFilter) &&
          (!severityFilter || item.severity === severityFilter) &&
          inStatusFilter(item, statusFilter) &&
          matches(query, item.human_id, item.title, item.detail, item.page_url, item.raised_by_name ?? ""),
      ),
    [rows, query, envFilter, kindFilter, severityFilter, statusFilter],
  );
  const filtered =
    query.trim() !== "" ||
    envFilter !== "" ||
    kindFilter !== "" ||
    severityFilter !== "" ||
    statusFilter !== DEFAULT_STATUS_FILTER;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Feedback</h1>
        <span className="shell-spacer" />
        {canRaiseFeedback && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            Raise feedback
          </button>
        )}
      </div>

      <EnvironmentCards
        environments={envs}
        loading={environments.loading}
        error={environments.error}
        settingsHref={canPublish ? `/orgs/${orgId}/projects/${project.id}/details` : null}
      />

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search feedback", label: "Search feedback" }}
        filters={[
          {
            label: "Filter by environment",
            value: envFilter,
            onChange: setEnvFilter,
            options: [
              { value: "", label: "All environments" },
              ...envs.map((e) => ({ value: e.slug, label: e.label })),
            ],
          },
          {
            label: "Filter by type",
            value: kindFilter,
            onChange: setKindFilter,
            options: [
              { value: "", label: "All types" },
              ...FEEDBACK_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
            ],
          },
          {
            label: "Filter by severity",
            value: severityFilter,
            onChange: setSeverityFilter,
            options: [
              { value: "", label: "All severities" },
              ...FEEDBACK_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] })),
            ],
          },
          {
            label: "Filter by status",
            value: statusFilter,
            defaultValue: DEFAULT_STATUS_FILTER,
            onChange: setStatusFilter,
            options: [
              { value: OPEN_ONLY, label: "Open" },
              { value: "", label: "All statuses" },
              ...FEEDBACK_STATUSES.map((s) => ({ value: s, label: s })),
            ],
          },
        ]}
        count={{ visible: visible.length, total: rows.length, noun: ["report", "reports"] }}
      />

      <ListTable
        columns={[
          {
            header: "Report",
            className: "primary",
            render: (item) => (
              <NameCell sub={item.detail || undefined} onOpen={() => openDrawer(item)}>
                {item.human_id} · {item.title}
                {item.screenshot_count > 0 && (
                  <span className="badge muted" title={`${item.screenshot_count} screenshots`}>
                    {item.screenshot_count} shot{item.screenshot_count === 1 ? "" : "s"}
                  </span>
                )}
              </NameCell>
            ),
          },
          {
            header: "Environment",
            render: (item) => labelOf.get(item.environment) ?? item.environment,
          },
          {
            header: "Type",
            render: (item) => <span className={`badge ${KIND_BADGE[item.kind]}`}>{KIND_LABELS[item.kind]}</span>,
          },
          {
            header: "Severity",
            render: (item) => (
              <span className={`badge ${SEVERITY_BADGE[item.severity]}`}>{SEVERITY_LABELS[item.severity]}</span>
            ),
          },
          {
            header: "Status",
            render: (item) => <span className={`badge ${STATUS_BADGE[item.status]}`}>{item.status}</span>,
          },
          {
            header: "Raised by",
            render: (item) => item.raised_by_name ?? item.raised_by_email ?? <span className="muted">Unknown</span>,
          },
          {
            header: "Raised",
            className: "when muted",
            render: (item) => formatDateTime(item.created_at),
          },
        ]}
        rows={visible}
        rowKey={(item) => item.id}
        rowLabel={(item) => item.title}
        actions={(item) =>
          canWrite
            ? [
                { label: "Triage", onSelect: () => openDrawer(item) },
                { label: "Delete", danger: true, onSelect: () => setDeleting(item) },
              ]
            : null
        }
        loading={reports.loading}
        error={reports.error}
        empty={
          filtered ? (
            "No feedback matches these filters."
          ) : canRaiseFeedback ? (
            <>
              <b>No feedback yet.</b> Open one of the environments above, then raise what you find against it.
            </>
          ) : (
            <b>No feedback yet.</b>
          )
        }
      />

      <Drawer
        open={drawerOpen}
        title={editing ? editing.human_id : raised ? raised.human_id : "Raise feedback"}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        width={520}
        footer={
          readOnly ? (
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
          ) : raised ? (
            <>
              <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
                Close
              </button>
              <button type="button" className="btn primary" disabled={saving} onClick={() => void retryShots()}>
                {saving ? "Uploading…" : "Retry screenshots"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" disabled={saving || !form.title.trim()}>
                {saving ? "Saving…" : editing ? "Save changes" : "Raise feedback"}
              </button>
            </>
          )
        }
      >
        <Field label="Environment">
          <select
            className="select"
            value={form.environment}
            disabled={readOnly}
            onChange={(e) => pickEnvironment(e.target.value as FeedbackInput["environment"])}
          >
            {envs.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Page address">
          <input
            className="input"
            type="url"
            placeholder="https://…"
            value={form.page_url}
            disabled={readOnly}
            onChange={(e) => {
              setUrlTouched(true);
              patch({ page_url: e.target.value });
            }}
          />
        </Field>
        <Field label="Type">
          <select
            className="select"
            value={form.kind}
            disabled={readOnly}
            onChange={(e) => patch({ kind: e.target.value as FeedbackKind })}
          >
            {FEEDBACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select
            className="select"
            value={form.severity}
            disabled={readOnly}
            onChange={(e) => patch({ severity: e.target.value as FeedbackSeverity })}
          >
            {FEEDBACK_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Summary">
          <input
            className="input"
            required
            value={form.title}
            disabled={readOnly}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
        <Field label="Detail">
          <textarea
            className="input textarea"
            rows={6}
            value={form.detail}
            disabled={readOnly}
            onChange={(e) => patch({ detail: e.target.value })}
          />
        </Field>
        {editing && canWrite && (
          <Field label="Status">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Screenshots">
          <ScreenshotField
            items={shots}
            disabled={readOnly}
            onAdd={(file, bitmap) =>
              setShots((current) => [
                ...current,
                { id: `${Date.now()}-${current.length}`, file, bitmap, status: "queued" },
              ])
            }
            onRemove={(id) =>
              setShots((current) => {
                const going = current.find((s) => s.id === id);
                going?.bitmap.close();
                return current.filter((s) => s.id !== id);
              })
            }
          />
        </Field>

        {editing && (
          <Field label="Raised">
            <span className="muted">
              {editing.raised_by_name ?? editing.raised_by_email ?? "Unknown"} ·{" "}
              {formatDateTime(editing.created_at)}
            </span>
          </Field>
        )}
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete feedback"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteFeedback(project.id, deleting.id);
          await reports.reload();
        }}
      >
        <p>
          Delete <b>{deleting?.human_id}</b>? Declining a report keeps the record of it being raised; deleting it
          does not.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

/**
 * The three environments, in the order a build is promoted through them. A
 * published one is the card itself, so the whole card is the way in; an
 * unpublished one keeps its place, because the gap is the news.
 *
 * Nothing here edits an address -- they are set on the project details page,
 * beside the repository link. For someone who could set one the empty card
 * becomes the way there, so the dead end is an affordance rather than a line
 * of prose telling them where to go.
 */
function EnvironmentCards({
  environments,
  loading,
  error,
  settingsHref,
}: {
  environments: Environment[];
  loading: boolean;
  error: string | null;
  settingsHref: string | null;
}) {
  if (error) return <div className="status-banner warn">{error}</div>;
  if (loading && environments.length === 0) return <div className="muted">Loading environments…</div>;

  return (
    <div className="card-grid env-grid">
      {environments.map((env) => {
        const body = (
          <>
            <h3>{env.label}</h3>
            {env.url ? <p className="env-url">{env.url}</p> : <p>No address published.</p>}
          </>
        );
        if (env.url) {
          return (
            <a key={env.slug} className="card env-card" href={env.url} target="_blank" rel="noreferrer noopener">
              {body}
            </a>
          );
        }
        return settingsHref ? (
          <Link key={env.slug} className="card env-card unset" to={settingsHref}>
            {body}
          </Link>
        ) : (
          <div key={env.slug} className="card env-card unset">
            {body}
          </div>
        );
      })}
    </div>
  );
}
