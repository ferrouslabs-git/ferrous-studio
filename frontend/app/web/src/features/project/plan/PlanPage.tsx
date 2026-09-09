// A release's plan: its sprints and the requirements moving through them.
// Reached only by drilling into a release from the Roadmap (or "Unscheduled"
// for work with no release yet) -- not a nav item of its own, matching
// software-management's own structure (static/js/views.js, 2026-09-07):
// "Two nav tabs: Roadmap and Epics. Everything else is a page you drill
// into." Ferrous Studio's board originally gave this a third, permanent tab.
import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatDate, formatDateTime } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { getTenantUsers } from "../../../core/umApi";
import { Epic, listEpics } from "../epics/epicsApi";
import { Feature, listFeatures } from "../epics/featuresApi";
import { Release, listReleases } from "../roadmap/releasesApi";
import { useProject } from "../ProjectLayout";
import { Agent, createAgent, deleteAgent, listAgents, updateAgent } from "./boardAgentsApi";
import { BoardComment, createBoardComment, deleteBoardComment, listBoardComments } from "./boardCommentsApi";
import {
  claimRequirement,
  createRequirement,
  deleteRequirement,
  listRequirements,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  Requirement,
  RequirementInput,
  RequirementPriority,
  RequirementStatus,
  updateRequirement,
} from "./requirementsApi";
import { Burndown, createSprint, deleteSprint, getBurndown, listSprints, Sprint, SprintInput, SprintState, updateSprint } from "./sprintsApi";

const EMPTY_SPRINT: SprintInput = { name: "", goal: "", start_date: null, end_date: null, release_id: null, capacity_hours: null };
const EMPTY_REQUIREMENT: RequirementInput = {
  title: "",
  body: "",
  epic_id: null,
  feature_id: null,
  status: "Todo",
  priority: "Medium",
  assignee_id: null,
  release_id: null,
  sprint_id: null,
};

const STATUS_BADGE: Record<RequirementStatus, string> = {
  Todo: "muted",
  Doing: "accent",
  Review: "accent",
  Blocked: "warn",
  Done: "good",
};
const PRIORITY_BADGE: Record<RequirementPriority, string> = { Low: "muted", Medium: "muted", High: "warn", Urgent: "warn" };
const SPRINT_STATE_BADGE: Record<SprintState, string> = { planned: "muted", active: "accent", done: "good" };

export function PlanPage() {
  const { project, orgId, canWrite } = useProject();
  const { releaseId: releaseIdParam } = useParams<{ releaseId: string }>();
  const scopeReleaseId = releaseIdParam === "unscheduled" ? null : releaseIdParam ?? null;

  const sprints = useLoad(() => listSprints(project.id), [project.id]);
  const requirements = useLoad(() => listRequirements(project.id), [project.id]);
  const epics = useLoad(() => listEpics(project.id), [project.id]);
  const releases = useLoad(() => listReleases(project.id), [project.id]);
  const members = useLoad(() => getTenantUsers(orgId, "active"), [orgId]);

  const epicById = useMemo(() => new Map((epics.data ?? []).map((e) => [e.id, e])), [epics.data]);
  const releaseById = useMemo(() => new Map((releases.data ?? []).map((r) => [r.id, r])), [releases.data]);
  const sprintById = useMemo(() => new Map((sprints.data ?? []).map((s) => [s.id, s])), [sprints.data]);
  const memberById = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m])), [members.data]);

  const scopedSprints = useMemo(
    () => ({ ...sprints, data: (sprints.data ?? []).filter((s) => (s.release_id ?? null) === scopeReleaseId) }),
    [sprints, scopeReleaseId],
  );
  const scopedRequirements = useMemo(
    () => ({
      ...requirements,
      data: (requirements.data ?? []).filter((r) => (r.effective_release_id ?? null) === scopeReleaseId),
    }),
    [requirements, scopeReleaseId],
  );

  const reloadAll = () => Promise.all([sprints.reload(), requirements.reload()]);

  const release = scopeReleaseId ? releaseById.get(scopeReleaseId) : null;

  return (
    <div className="page stack">
      <div className="page-head">
        <div className="stack" style={{ gap: 2 }}>
          <Link to={`/orgs/${orgId}/projects/${project.id}/roadmap`} className="muted" style={{ fontSize: 12 }}>
            ← Roadmap
          </Link>
          <h1>{scopeReleaseId ? release?.title ?? "Release" : "Unscheduled"}</h1>
        </div>
      </div>

      <SprintsSection
        projectId={project.id}
        canWrite={canWrite}
        sprints={scopedSprints}
        releases={releases.data ?? []}
        releaseById={releaseById}
        defaultReleaseId={scopeReleaseId}
        onChanged={reloadAll}
      />

      <RequirementsSection
        projectId={project.id}
        canWrite={canWrite}
        requirements={scopedRequirements}
        epics={epics.data ?? []}
        releases={releases.data ?? []}
        sprints={sprints.data ?? []}
        members={members.data ?? []}
        epicById={epicById}
        releaseById={releaseById}
        sprintById={sprintById}
        memberById={memberById}
        defaultReleaseId={scopeReleaseId}
        onChanged={reloadAll}
      />
    </div>
  );
}

// ── Sprints ──────────────────────────────────────────────────────────────

function SprintsSection({
  projectId,
  canWrite,
  sprints,
  releases,
  releaseById,
  defaultReleaseId,
  onChanged,
}: {
  projectId: string;
  canWrite: boolean;
  sprints: ReturnType<typeof useLoad<Sprint[]>>;
  releases: Release[];
  releaseById: Map<string, Release>;
  defaultReleaseId: string | null;
  onChanged: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Sprint | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Sprint | null>(null);
  const [viewingBurndown, setViewingBurndown] = useState<Sprint | null>(null);
  const [viewingAgents, setViewingAgents] = useState<Sprint | null>(null);
  const [form, setForm] = useState<SprintInput>(EMPTY_SPRINT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const patch = (p: Partial<SprintInput>) => setForm((f) => ({ ...f, ...p }));

  const openDrawer = (s: Sprint | null) => {
    setEditing(s);
    setForm(
      s
        ? {
            name: s.name,
            goal: s.goal,
            start_date: s.start_date,
            end_date: s.end_date,
            release_id: s.release_id,
            capacity_hours: s.capacity_hours,
          }
        : { ...EMPTY_SPRINT, release_id: defaultReleaseId },
    );
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body: SprintInput = {
      name: form.name.trim(),
      goal: form.goal?.trim() || "",
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      release_id: form.release_id || null,
      capacity_hours: form.capacity_hours ?? null,
    };
    try {
      if (editing) await updateSprint(projectId, editing.id, { ...body, clear_release: !body.release_id });
      else await createSprint(projectId, body);
      setDrawerOpen(false);
      await onChanged();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setState = async (s: Sprint, state: SprintState) => {
    try {
      const result = await updateSprint(projectId, s.id, { state });
      if (result.returned_to_backlog > 0) {
        setNotice(`${result.returned_to_backlog} unfinished requirement(s) returned to the backlog.`);
      }
      await onChanged();
    } catch (err) {
      setNotice(errorMessage(err));
    }
  };

  const rows = sprints.data ?? [];

  return (
    <section className="section">
      <div className="section-head">
        <h2>Sprints</h2>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary small" onClick={() => openDrawer(null)}>
            New sprint
          </button>
        )}
      </div>
      <div className="section-body stack">
        {notice && <div className="status-banner warn">{notice}</div>}
        <ListTable
          columns={[
            {
              header: "Sprint",
              className: "primary",
              render: (s) => (
                <NameCell sub={s.goal || undefined} onOpen={canWrite ? () => openDrawer(s) : undefined}>
                  {s.human_id} · {s.name}
                </NameCell>
              ),
            },
            { header: "State", render: (s) => <span className={`badge ${SPRINT_STATE_BADGE[s.state]}`}>{s.state}</span> },
            {
              header: "Dates",
              className: "when",
              render: (s) => (s.start_date && s.end_date ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}` : <span className="muted">Not scheduled</span>),
            },
            {
              header: "Release",
              render: (s) => (s.release_id ? releaseById.get(s.release_id)?.title ?? "—" : <span className="muted">None</span>),
            },
          ]}
          rows={rows}
          rowKey={(s) => s.id}
          rowLabel={(s) => s.name}
          actions={(s) => {
            const items = [
              { label: "Burndown", onSelect: () => setViewingBurndown(s) },
              { label: "Agents", onSelect: () => setViewingAgents(s) },
            ];
            if (!canWrite) return items;
            if (s.state === "planned") items.push({ label: "Start sprint", onSelect: () => void setState(s, "active") });
            if (s.state === "active") items.push({ label: "Complete sprint", onSelect: () => void setState(s, "done") });
            items.push({ label: "Edit", onSelect: () => openDrawer(s) });
            items.push({ label: "Delete", danger: true, onSelect: () => setDeleting(s) } as never);
            return items;
          }}
          loading={sprints.loading}
          error={sprints.error}
          empty={<><b>No sprints yet.</b> {canWrite ? "Group requirements into a time box to track them." : "Nothing here yet."}</>}
        />
      </div>

      <Drawer
        open={drawerOpen}
        title={editing ? `Edit ${editing.human_id}` : "New sprint"}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create sprint"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" required placeholder="e.g. Sprint 4" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="Goal">
          <textarea className="input textarea" rows={2} value={form.goal} onChange={(e) => patch({ goal: e.target.value })} />
        </Field>
        <Field label="Start date" hint="Both dates are needed to see a burndown chart.">
          <input className="input" type="date" value={form.start_date ?? ""} onChange={(e) => patch({ start_date: e.target.value || null })} />
        </Field>
        <Field label="End date">
          <input className="input" type="date" value={form.end_date ?? ""} onChange={(e) => patch({ end_date: e.target.value || null })} />
        </Field>
        <Field label="Release" hint="Which release this sprint is planned to deliver -- its end date, if set, becomes that release's date.">
          <select className="select" value={form.release_id ?? ""} onChange={(e) => patch({ release_id: e.target.value || null })}>
            <option value="">No release</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Capacity (hours)" hint="Optional -- how much the sprint can hold.">
          <input
            className="input"
            type="number"
            min={0}
            value={form.capacity_hours ?? ""}
            onChange={(e) => patch({ capacity_hours: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete sprint"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteSprint(projectId, deleting.id);
          await onChanged();
        }}
      >
        <p>
          Delete <b>{deleting?.name}</b>? Its requirements return to the backlog, not deleted.
        </p>
      </ConfirmDrawer>

      {viewingBurndown && <BurndownDrawer projectId={projectId} sprint={viewingBurndown} onClose={() => setViewingBurndown(null)} />}
      {viewingAgents && <AgentsDrawer projectId={projectId} sprint={viewingAgents} canWrite={canWrite} onClose={() => setViewingAgents(null)} />}
    </section>
  );
}

function BurndownDrawer({ projectId, sprint, onClose }: { projectId: string; sprint: Sprint; onClose: () => void }) {
  const burndown = useLoad(() => getBurndown(projectId, sprint.id), [projectId, sprint.id]);

  return (
    <Drawer open title={`${sprint.human_id} burndown`} onClose={onClose} width={560}>
      {burndown.loading && <p className="muted">Loading…</p>}
      {burndown.error && <div className="status-banner warn">{burndown.error}</div>}
      {burndown.data && <BurndownChart burndown={burndown.data} />}
    </Drawer>
  );
}

function BurndownChart({ burndown }: { burndown: Burndown }) {
  if (burndown.note) return <p className="muted">{burndown.note}</p>;
  if (burndown.points.length === 0) return <p className="muted">No requirements have been in this sprint yet.</p>;

  const width = 480;
  const height = 220;
  const padding = 28;
  const maxY = Math.max(burndown.total_start, 1);
  const n = burndown.points.length;
  const x = (i: number) => padding + (i / Math.max(n - 1, 1)) * (width - padding * 2);
  const y = (v: number) => height - padding - (v / maxY) * (height - padding * 2);

  const idealPath = burndown.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.ideal ?? 0)}`).join(" ");
  const actualPoints = burndown.points.filter((p) => p.remaining !== null);
  const actualPath = actualPoints.map((p, i) => `${i === 0 ? "M" : "L"}${x(burndown.points.indexOf(p))},${y(p.remaining ?? 0)}`).join(" ");

  return (
    <div className="stack">
      <p className="muted">Starting total: {burndown.total_start}</p>
      <svg width={width} height={height} role="img" aria-label="Sprint burndown chart">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border)" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="var(--border)" />
        <path d={idealPath} fill="none" stroke="var(--border-strong)" strokeDasharray="4 3" strokeWidth={1.5} />
        {actualPath && <path d={actualPath} fill="none" stroke="var(--accent)" strokeWidth={2} />}
        {burndown.points.map((p, i) => (
          <text key={p.day} x={x(i)} y={height - padding + 14} fontSize={9} fill="var(--text-dim)" textAnchor="middle">
            {formatDate(p.day).replace(/ \d{4}$/, "")}
          </text>
        ))}
      </svg>
      <div className="stack" style={{ flexDirection: "row", gap: 16, fontSize: 12 }}>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--accent)", marginRight: 4 }} /> Remaining
        </span>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, border: "1px dashed var(--border-strong)", marginRight: 4 }} /> Ideal
        </span>
      </div>
    </div>
  );
}

const AGENT_STATUS_BADGE: Record<string, string> = { running: "accent", stopped: "muted", error: "warn" };

// Agents are run from the sprint board, not a separate view of their own --
// ported placement decision from software-management (static/js/views.js,
// 2026-09-04): "Overview, Agents and Work History left the nav the same
// day: agents are run from the sprint board." An agent works exactly one
// sprint's Todo requirements in queue order; starting one only succeeds if
// the environment actually configures somewhere to launch it
// (AGENT_ECS_CLUSTER etc.) -- otherwise it fails with that said plainly,
// not a silent no-op.
function AgentsDrawer({
  projectId,
  sprint,
  canWrite,
  onClose,
}: {
  projectId: string;
  sprint: Sprint;
  canWrite: boolean;
  onClose: () => void;
}) {
  const agents = useLoad(() => listAgents(projectId), [projectId]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forThisSprint = (agents.data ?? []).filter((a) => a.sprint_id === sprint.id);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createAgent(projectId, newName.trim(), sprint.id);
      setNewName("");
      await agents.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (a: Agent) => {
    setBusyId(a.id);
    setError(null);
    try {
      await updateAgent(projectId, a.id, { desired_state: a.status === "running" ? "stopped" : "running" });
      await agents.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: Agent) => {
    await deleteAgent(projectId, a.id);
    await agents.reload();
  };

  return (
    <Drawer open title={`${sprint.human_id} agents`} onClose={onClose} width={480}>
      <div className="stack" style={{ gap: 10 }}>
        {agents.loading && <p className="muted">Loading…</p>}
        {forThisSprint.length === 0 && !agents.loading && <span className="muted">No agents assigned to this sprint yet.</span>}
        {forThisSprint.map((a) => (
          <div key={a.id} className="section" style={{ padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b>{a.name}</b>
              <span className={`badge ${AGENT_STATUS_BADGE[a.status]}`}>{a.status}</span>
              <span className="shell-spacer" />
              {canWrite && (
                <>
                  <button type="button" className="btn small ghost" disabled={busyId === a.id} onClick={() => void toggle(a)}>
                    {a.status === "running" ? "Stop" : "Start"}
                  </button>
                  <button type="button" className="btn icon ghost" aria-label={`Delete ${a.name}`} onClick={() => void remove(a)}>
                    ×
                  </button>
                </>
              )}
            </div>
            {a.last_error && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{a.last_error}</p>}
          </div>
        ))}
        {canWrite && (
          <div className="list-editor-row">
            <input
              className="input"
              placeholder="e.g. Claude worker"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <button type="button" className="btn small ghost" disabled={creating || !newName.trim()} onClick={() => void create()}>
              + Agent
            </button>
          </div>
        )}
        {error && <div className="status-banner warn">{error}</div>}
      </div>
    </Drawer>
  );
}

// ── Requirements ─────────────────────────────────────────────────────────

function RequirementsSection({
  projectId,
  canWrite,
  requirements,
  epics,
  releases,
  sprints,
  members,
  epicById,
  releaseById,
  sprintById,
  memberById,
  defaultReleaseId,
  onChanged,
}: {
  projectId: string;
  canWrite: boolean;
  requirements: ReturnType<typeof useLoad<Requirement[]>>;
  epics: Epic[];
  releases: Release[];
  sprints: Sprint[];
  members: { user_id: string; email: string; name: string | null }[];
  epicById: Map<string, Epic>;
  releaseById: Map<string, Release>;
  sprintById: Map<string, Sprint>;
  memberById: Map<string, { user_id: string; email: string; name: string | null }>;
  defaultReleaseId: string | null;
  onChanged: () => Promise<unknown>;
}) {
  const { project } = useProject();
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Requirement | null>(null);
  const [form, setForm] = useState<RequirementInput>(EMPTY_REQUIREMENT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sprintFilter, setSprintFilter] = useState("");

  const features = useLoad(() => (form.epic_id ? listFeatures(projectId, form.epic_id) : Promise.resolve([])), [form.epic_id]);
  const comments = useLoad(
    () => (editing ? listBoardComments(projectId, "requirement", editing.id) : Promise.resolve([])),
    [editing?.id],
  );
  const [newComment, setNewComment] = useState("");

  const patch = (p: Partial<RequirementInput>) => setForm((f) => ({ ...f, ...p }));

  const openDrawer = (r: Requirement | null) => {
    setEditing(r);
    setForm(
      r
        ? {
            title: r.title, body: r.body, epic_id: r.epic_id, feature_id: r.feature_id,
            status: r.status, priority: r.priority, assignee_id: r.assignee_id,
            release_id: r.release_id, sprint_id: r.sprint_id,
          }
        : {
            ...EMPTY_REQUIREMENT,
            release_id: defaultReleaseId,
            sprint_id: sprintFilter || null,
            status: (statusFilter as RequirementInput["status"]) || EMPTY_REQUIREMENT.status,
          },
    );
    setFormError(null);
    setNewComment("");
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await updateRequirement(project.id, editing.id, {
          ...form,
          clear_epic: form.epic_id === null,
          clear_feature: form.feature_id === null,
          clear_assignee: form.assignee_id === null,
          clear_release: form.release_id === null,
          clear_sprint: form.sprint_id === null,
        });
      } else {
        await createRequirement(project.id, { ...form, title: form.title.trim() });
      }
      setDrawerOpen(false);
      await onChanged();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const claim = async (r: Requirement) => {
    try {
      await claimRequirement(project.id, r.id);
      await onChanged();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const addComment = async () => {
    if (!editing || !newComment.trim()) return;
    await createBoardComment(project.id, "requirement", editing.id, newComment.trim());
    setNewComment("");
    await comments.reload();
  };

  const all = requirements.data ?? [];
  const visible = useMemo(
    () =>
      all.filter(
        (r) =>
          (!statusFilter || r.status === statusFilter) &&
          (!sprintFilter || r.sprint_id === sprintFilter) &&
          matches(query, r.human_id, r.title, r.body),
      ),
    [all, query, statusFilter, sprintFilter],
  );
  const filtered = query.trim() !== "" || statusFilter !== "" || sprintFilter !== "";

  return (
    <section className="section">
      <div className="section-head">
        <h2>Requirements</h2>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary small" onClick={() => openDrawer(null)}>
            New requirement
          </button>
        )}
      </div>
      <div className="section-body stack">
        <ListToolbar
          search={{ value: query, onChange: setQuery, placeholder: "Search requirements", label: "Search requirements" }}
          filters={[
            { label: "Filter by status", value: statusFilter, onChange: setStatusFilter, options: [{ value: "", label: "All statuses" }, ...REQUIREMENT_STATUSES.map((s) => ({ value: s, label: s }))] },
            { label: "Filter by sprint", value: sprintFilter, onChange: setSprintFilter, options: [{ value: "", label: "All sprints" }, ...sprints.map((s) => ({ value: s.id, label: s.name }))] },
          ]}
          count={{ visible: visible.length, total: all.length, noun: ["requirement", "requirements"] }}
        />

        <ListTable
          columns={[
            {
              header: "Requirement",
              className: "primary",
              render: (r) => (
                <NameCell onOpen={canWrite ? () => openDrawer(r) : undefined}>
                  {r.human_id} · {r.title}
                </NameCell>
              ),
            },
            {
              header: "Status",
              render: (r) => (
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                  {r.status === "Blocked" && r.blocked_from && (
                    <span className="badge muted" title="Returns here when unblocked">
                      was {r.blocked_from}
                    </span>
                  )}
                </span>
              ),
            },
            { header: "Priority", render: (r) => <span className={`badge ${PRIORITY_BADGE[r.priority]}`}>{r.priority}</span> },
            { header: "Epic", render: (r) => (r.effective_epic_id ? epicById.get(r.effective_epic_id)?.title ?? "—" : <span className="muted">—</span>) },
            { header: "Sprint", render: (r) => (r.sprint_id ? sprintById.get(r.sprint_id)?.name ?? "—" : <span className="muted">Backlog</span>) },
            { header: "Assignee", render: (r) => (r.assignee_id ? memberById.get(r.assignee_id)?.name ?? memberById.get(r.assignee_id)?.email ?? "—" : <span className="muted">Unassigned</span>) },
          ]}
          rows={visible}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.title}
          actions={(r) => {
            if (!canWrite) return null;
            const items = [{ label: "Edit", onSelect: () => openDrawer(r) }];
            if (r.status === "Todo") items.push({ label: "Claim (start work)", onSelect: () => void claim(r) });
            items.push({ label: "Delete", danger: true, onSelect: () => setDeleting(r) } as never);
            return items;
          }}
          loading={requirements.loading}
          error={requirements.error}
          empty={filtered ? "No requirements match these filters." : <><b>No requirements yet.</b> {canWrite ? "Add the work items that make up this project." : "Nothing here yet."}</>}
        />
      </div>

      <Drawer
        open={drawerOpen}
        title={editing ? `Edit ${editing.human_id}` : "New requirement"}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        width={560}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !form.title.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create requirement"}
            </button>
          </>
        }
      >
        <Field label="Title">
          <input className="input" required value={form.title} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="input textarea" rows={3} value={form.body} onChange={(e) => patch({ body: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className="select" value={form.status} onChange={(e) => patch({ status: e.target.value as RequirementInput["status"] })}>
            {REQUIREMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select className="select" value={form.priority} onChange={(e) => patch({ priority: e.target.value as RequirementInput["priority"] })}>
            {REQUIREMENT_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Epic">
          <select className="select" value={form.epic_id ?? ""} onChange={(e) => patch({ epic_id: e.target.value || null, feature_id: null })}>
            <option value="">None</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>{e.human_id} · {e.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Feature" hint="Only if this belongs under a specific feature of the epic above.">
          <select className="select" value={form.feature_id ?? ""} onChange={(e) => patch({ feature_id: e.target.value || null })} disabled={!form.epic_id}>
            <option value="">None</option>
            {(features.data ?? []).map((f: Feature) => (
              <option key={f.id} value={f.id}>{f.human_id} · {f.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Release" hint="Leave unset to inherit the epic's release.">
          <select className="select" value={form.release_id ?? ""} onChange={(e) => patch({ release_id: e.target.value || null })}>
            <option value="">Inherit from epic</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Sprint">
          <select className="select" value={form.sprint_id ?? ""} onChange={(e) => patch({ sprint_id: e.target.value || null })}>
            <option value="">Backlog</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>{s.human_id} · {s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <select className="select" value={form.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value || null })}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.name ?? m.email}</option>
            ))}
          </select>
        </Field>

        {formError && <div className="status-banner warn">{formError}</div>}

        {editing && (
          <Field label="Comments">
            <div className="stack" style={{ gap: 8 }}>
              {(comments.data ?? []).length === 0 && <span className="muted">No comments yet.</span>}
              {(comments.data ?? []).map((c: BoardComment) => (
                <div key={c.id} className="section" style={{ padding: 8 }}>
                  <div className="muted" style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                    <span>{memberById.get(c.author_id)?.name ?? memberById.get(c.author_id)?.email ?? "Someone"}</span>
                    <span>{formatDateTime(c.created_at)}</span>
                  </div>
                  <p style={{ margin: "4px 0 0" }}>{c.body}</p>
                  {canWrite && (
                    <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => void deleteBoardComment(project.id, c.id).then(() => comments.reload())}>
                      Delete
                    </button>
                  )}
                </div>
              ))}
              <div className="list-editor-row">
                <input className="input" placeholder="Add a comment" value={newComment} onChange={(e) => setNewComment(e.target.value)} />
                <button type="button" className="btn small ghost" disabled={!newComment.trim()} onClick={() => void addComment()}>
                  Post
                </button>
              </div>
            </div>
          </Field>
        )}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete requirement"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteRequirement(project.id, deleting.id);
          await onChanged();
        }}
      >
        <p>Delete <b>{deleting?.title}</b>? This cannot be undone.</p>
      </ConfirmDrawer>
    </section>
  );
}
