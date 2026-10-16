// Feedback: the deployed environments this project can be reached at, what
// people found when they went there, and (the Maintenance log tab) the support
// hours the fixes are paid for from.
//
// This is the one delivery section an organisation *member* can write to. They
// raise reports; only an admin triages, corrects or deletes one, so the page
// has two readings of the same table -- see `canWrite` versus
// `canRaiseFeedback` below. Neither is narrowed by a locked version: an
// environment stays live whatever a frozen design version says, and freezing
// v1 must not silence the people testing it.
//
// Triage gives a report the support-desk half of a requirement (FS-REQ-52):
// an assignee, an estimate, a comment thread, and a resolution time stamped
// by the server when it reaches Resolved. The page sits under BoardProvider
// for those -- the assignee picker, the comment thread and the link to a
// requirement raised from a report (FS-REQ-51) all read the shared board.
import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../../app/session";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { Badges, ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatDateTime, parseUtcDate } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { ScreenshotField, ScreenshotItem } from "../../screenshot/ScreenshotField";
import { listAttachments, loadAttachmentBitmap } from "../attachmentsApi";
import { AssigneeSelect } from "../board/AssigneeSelect";
import { useBoard } from "../board/boardData";
import { IdChip } from "../board/chips";
import { CommentsList } from "../board/CommentsList";
import { EstimateField } from "../board/EstimateField";
import { useToast } from "../board/toast";
import { useEntityHref } from "../board/useGoTo";
import { useProject } from "../ProjectLayout";
import {
  CLOSED_STATUSES,
  createFeedback,
  createRequirementFromFeedback,
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
  STATUS_LABELS,
  listEnvironments,
  listFeedback,
  updateFeedback,
  uploadFeedbackScreenshots,
} from "./feedbackApi";
import { fmtDuration, fmtHours } from "./maintenance";
import { MaintenanceLog } from "./MaintenanceLog";

// The environment is filled in when the form opens: the first in the list.
const EMPTY: FeedbackInput = {
  environment: "",
  kind: "feedback",
  severity: "medium",
  title: "",
  detail: "",
  page_url: "",
};

/** What triage sets, beside the reporter's own fields. */
interface Triage {
  status: FeedbackStatus;
  assignee_id: string | null;
  estimate_hours: number | null;
}

const EMPTY_TRIAGE: Triage = { status: "New", assignee_id: null, estimate_hours: null };

/** A report still waiting on someone is news; one with its outcome is not. */
const STATUS_BADGE: Record<FeedbackStatus, string> = {
  New: "accent",
  EstimatedToConfirm: "warn",
  OnHold: "muted",
  NotABug: "muted",
  Confirmed: "warn",
  InProgress: "accent",
  Resolved: "good",
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
 * resolved or turned into backlog has already had its outcome, and leaving it
 * in the default view buries the reports still waiting for one. Clearing the
 * filter (the toolbar's Clear, or picking "All statuses") shows everything.
 */
const OPEN_ONLY = "open";
const DEFAULT_STATUS_FILTER = OPEN_ONLY;

function inStatusFilter(item: Feedback, filter: string): boolean {
  if (filter === "") return true;
  if (filter === OPEN_ONLY) return !CLOSED_STATUSES.has(item.status);
  return item.status === filter;
}

/** How long a resolved report took, from being raised; null if it is not resolved. */
function resolutionTime(item: Feedback): string | null {
  if (!item.resolved_at) return null;
  return fmtDuration(parseUtcDate(item.resolved_at).getTime() - parseUtcDate(item.created_at).getTime());
}

type Tab = "reports" | "maintenance";
const TABS: { id: Tab; label: string }[] = [
  { id: "reports", label: "Reports" },
  { id: "maintenance", label: "Maintenance log" },
];

export function FeedbackPage() {
  const { project, orgId, canWriteBoard: canWrite, canRaiseFeedback } = useProject();
  // The organisation role, not the lock-narrowed one: addresses are set on the
  // project details page, which stays open on a frozen version (see
  // EnvironmentsSection). Only used to decide whether an unpublished
  // environment is worth offering a way in to.
  const { canWrite: canPublish } = useSession();
  const board = useBoard();
  const toast = useToast();
  const hrefFor = useEntityHref();
  const environments = useLoad(() => listEnvironments(project.id), [project.id]);
  const reports = useLoad(() => listFeedback(project.id), [project.id]);

  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "maintenance" ? "maintenance" : "reports";
  const selectTab = (t: Tab) => setParams(t === "reports" ? {} : { tab: t }, { replace: true });
  // The Maintenance log's "Add contract" lives in this page head; each click
  // bumps the counter the tab watches.
  const [addContract, setAddContract] = useState(0);

  const [editing, setEditing] = useState<Feedback | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Feedback | null>(null);
  const [form, setForm] = useState<FeedbackInput>(EMPTY);
  const [triage, setTriage] = useState<Triage>(EMPTY_TRIAGE);
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
  const patchTriage = (p: Partial<Triage>) => setTriage((t) => ({ ...t, ...p }));

  /** The published address of an environment, "" when it has none. */
  const addressOf = (slug: string) => envs.find((e) => e.slug === slug)?.url ?? "";

  /** The live requirement raised from a report, if it still exists on the board. */
  const requirementOf = (item: Feedback) =>
    item.requirement_id ? board.index.requirementById.get(item.requirement_id) ?? null : null;
  // Until the board has loaded, a linked id cannot be told from a deleted one;
  // offering "Create requirement" then would only earn a 409.
  const canRaiseRequirement = (item: Feedback) =>
    canWrite && board.data !== null && requirementOf(item) === null;

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
        : { ...EMPTY, environment: envs[0]?.slug ?? "", page_url: envs[0]?.url ?? "" },
    );
    setUrlTouched(item !== null && item.page_url !== "");
    setTriage(
      item ? { status: item.status, assignee_id: item.assignee_id, estimate_hours: item.estimate_hours } : EMPTY_TRIAGE,
    );
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

  /** The form as an update: the reporter's fields plus triage. Clearing an
   *  assignee is the flag, as on a requirement -- a null id means "unchanged". */
  const updateBody = (item: Feedback) => ({
    ...form,
    title: form.title.trim(),
    detail: form.detail.trim(),
    page_url: form.page_url.trim(),
    status: triage.status,
    estimate_hours: triage.estimate_hours,
    ...(triage.assignee_id
      ? { assignee_id: triage.assignee_id }
      : item.assignee_id
        ? { clear_assignee: true }
        : {}),
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const report = editing
        ? await updateFeedback(project.id, editing.id, updateBody(editing))
        : await createFeedback(project.id, {
            ...form,
            title: form.title.trim(),
            detail: form.detail.trim(),
            page_url: form.page_url.trim(),
          });

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

  /**
   * Raise a board requirement from a report (FS-REQ-51). From the drawer the
   * form is saved first, so the requirement starts from what is on screen
   * rather than from what was last saved.
   */
  const raiseRequirement = async (item: Feedback, fromDrawer: boolean) => {
    setSaving(true);
    setFormError(null);
    try {
      if (fromDrawer) await updateFeedback(project.id, item.id, updateBody(item));
      const report = await createRequirementFromFeedback(project.id, item.id);
      await Promise.all([board.reload(["requirements"]), reports.reload()]);
      if (fromDrawer) setEditing(report);
      toast(`Requirement raised from ${report.human_id}`);
    } catch (err) {
      if (fromDrawer) setFormError(errorMessage(err));
      else toast(errorMessage(err), { type: "err", ttl: 6000 });
    } finally {
      setSaving(false);
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

  const linked = editing ? requirementOf(editing) : null;
  const linkedHref = linked ? hrefFor("requirement", linked.id) : null;
  const tookToResolve = editing ? resolutionTime(editing) : null;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Feedback</h1>
        <span className="shell-spacer" />
        {tab === "reports" && canRaiseFeedback && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            Raise feedback
          </button>
        )}
        {tab === "maintenance" && canWrite && (
          <button className="btn primary" onClick={() => setAddContract((n) => n + 1)}>
            Add contract
          </button>
        )}
      </div>

      <div className="page-subtabs" role="tablist" aria-label="Feedback">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`page-subtab${tab === t.id ? " active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "maintenance" ? (
        <MaintenanceLog
          projectId={project.id}
          reports={rows}
          canWrite={canWrite}
          creating={addContract}
        />
      ) : (
        <>
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
                  ...FEEDBACK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
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
                render: (item) => {
                  const comments = board.index.commentCount(item.id);
                  const requirement = requirementOf(item);
                  return (
                    <NameCell sub={item.detail || undefined} onOpen={() => openDrawer(item)}>
                      {item.human_id} · {item.title}
                      {item.screenshot_count > 0 && (
                        <span className="badge muted" title={`${item.screenshot_count} screenshots`}>
                          {item.screenshot_count} shot{item.screenshot_count === 1 ? "" : "s"}
                        </span>
                      )}
                      {comments > 0 && (
                        <span className="badge muted" title={`${comments} comments`}>
                          {comments} comment{comments === 1 ? "" : "s"}
                        </span>
                      )}
                      {requirement && (
                        <span className="badge accent" title={`Requirement ${requirement.human_id} raised from it`}>
                          {requirement.human_id}
                        </span>
                      )}
                    </NameCell>
                  );
                },
              },
              {
                header: "Environment",
                render: (item) => labelOf.get(item.environment) ?? item.environment,
              },
              {
                header: "Type",
                render: (item) => (
                  <Badges>
                    <span className={`badge ${KIND_BADGE[item.kind]}`}>{KIND_LABELS[item.kind]}</span>
                    <span className={`badge ${SEVERITY_BADGE[item.severity]}`}>{SEVERITY_LABELS[item.severity]}</span>
                  </Badges>
                ),
              },
              {
                header: "Status",
                render: (item) => {
                  const took = resolutionTime(item);
                  return (
                    <>
                      <span className={`badge ${STATUS_BADGE[item.status]}`}>{STATUS_LABELS[item.status]}</span>
                      {took && <span className="sub">in {took}</span>}
                    </>
                  );
                },
              },
              {
                header: "Assignee",
                render: (item) =>
                  item.assignee_id ? board.index.memberName(item.assignee_id) : <span className="muted">—</span>,
              },
              {
                header: "Estimate",
                className: "num",
                render: (item) =>
                  item.estimate_hours == null ? <span className="muted">—</span> : fmtHours(item.estimate_hours),
              },
              {
                header: "Raised",
                className: "when muted",
                render: (item) => (
                  <>
                    {formatDateTime(item.created_at)}
                    <span className="sub">{item.raised_by_name ?? item.raised_by_email ?? "Unknown"}</span>
                  </>
                ),
              },
            ]}
            rows={visible}
            rowKey={(item) => item.id}
            rowLabel={(item) => item.title}
            actions={(item) =>
              canWrite
                ? [
                    { label: "Triage", onSelect: () => openDrawer(item) },
                    ...(canRaiseRequirement(item)
                      ? [{ label: "Create requirement", onSelect: () => void raiseRequirement(item, false) }]
                      : []),
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
        </>
      )}

      <Drawer
        open={drawerOpen}
        title={editing ? editing.human_id : raised ? raised.human_id : "Raise feedback"}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        width={560}
        className="board-drawer"
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
        {editing && (
          <>
            <Field label="Status">
              <select
                className="select"
                value={triage.status}
                disabled={readOnly}
                onChange={(e) => patchTriage({ status: e.target.value as FeedbackStatus })}
              >
                {FEEDBACK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <AssigneeSelect
                value={triage.assignee_id}
                disabled={readOnly}
                onChange={(userId) => patchTriage({ assignee_id: userId })}
              />
            </Field>
            <Group label="Estimate">
              <EstimateField
                value={triage.estimate_hours}
                disabled={readOnly}
                onChange={(hours) => patchTriage({ estimate_hours: hours })}
              />
            </Group>
            {editing.resolved_at && (
              <Field label="Resolved">
                <span className="muted">
                  {formatDateTime(editing.resolved_at)}
                  {tookToResolve && ` · took ${tookToResolve}`}
                </span>
              </Field>
            )}
            {(linked || canRaiseRequirement(editing)) && (
              <Group label="Requirement">
                <span className="fb-requirement">
                  {linked ? (
                    <>
                      <IdChip of={{ type: "requirement", id: linked.id }}>{linked.human_id}</IdChip>
                      {linkedHref ? <Link to={linkedHref}>{linked.title}</Link> : <span>{linked.title}</span>}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={saving || !form.title.trim()}
                      onClick={() => void raiseRequirement(editing, true)}
                    >
                      Create requirement
                    </button>
                  )}
                </span>
              </Group>
            )}
          </>
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
        {editing && (
          <Group label="Comments">
            <CommentsList entityType="feedback" entityId={editing.id} />
          </Group>
        )}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete feedback"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteFeedback(project.id, deleting.id);
          await Promise.all([reports.reload(), board.reload(["comments"])]);
        }}
      >
        <p>
          Delete <b>{deleting?.human_id}</b>? Marking a report "Not a bug" keeps the record of it being raised;
          deleting it does not.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

/** A drawer field whose content holds several controls of its own (buttons,
 *  a thread). Field is a <label>, and a click on a label's text activates its
 *  first control -- here that would copy an id or open a comment for editing. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="drawer-field">
      <span className="drawer-field-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * Every environment, in the order a build is promoted through them. A
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
