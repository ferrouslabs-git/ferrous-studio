// A project's epics: the large bodies of work the roadmap is made of, each
// broken into features, each feature holding the requirements that actually
// get built. Progress is a status-weighted rollup computed server-side (see
// app/studio/board/service.py's progress_rollup) -- one implementation, not
// recomputed per page.
import { FormEvent, useMemo, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { Release, listReleases } from "../roadmap/releasesApi";
import { useProject } from "../ProjectLayout";
import { createEpic, deleteEpic, Epic, EPIC_STATUSES, EpicInput, EpicStatus, getBoardSummary, listEpics, updateEpic } from "./epicsApi";
import { createFeature, deleteFeature, Feature, listFeatures } from "./featuresApi";

const EMPTY: EpicInput = { title: "", summary: "", release_id: null };

const STATUS_BADGE: Record<EpicStatus, string> = {
  Readiness: "muted",
  Implementation: "accent",
  ReleasedToUAT: "warn",
  HumanValidation: "warn",
  Done: "good",
};

export function EpicsPage() {
  const { project, orgId, canWrite } = useProject();
  const summary = useLoad(() => getBoardSummary(project.id), [project.id]);
  const releases = useLoad(() => listReleases(project.id), [project.id]);
  const [editing, setEditing] = useState<Epic | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Epic | null>(null);
  const [form, setForm] = useState<EpicInput>(EMPTY);
  const [status, setStatus] = useState<EpicStatus>("Readiness");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Features for the epic currently open in the drawer.
  const features = useLoad(() => (editing ? listFeatures(project.id, editing.id) : Promise.resolve([])), [editing?.id]);
  const [newFeatureTitle, setNewFeatureTitle] = useState("");
  const [addingFeature, setAddingFeature] = useState(false);

  const releaseById = useMemo(() => new Map((releases.data ?? []).map((r) => [r.id, r])), [releases.data]);
  const patch = (p: Partial<EpicInput>) => setForm((f) => ({ ...f, ...p }));

  const openDrawer = (e: Epic | null) => {
    setEditing(e);
    setForm(e ? { title: e.title, summary: e.summary, release_id: e.release_id } : EMPTY);
    setStatus(e?.status ?? "Readiness");
    setNewFeatureTitle("");
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body = { title: form.title.trim(), summary: form.summary?.trim() || "", release_id: form.release_id };
    try {
      if (editing) {
        await updateEpic(project.id, editing.id, {
          ...body,
          status: status !== editing.status ? status : undefined,
          clear_release: body.release_id === null,
        });
      } else await createEpic(project.id, body);
      setDrawerOpen(false);
      await summary.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const addFeature = async () => {
    if (!editing || !newFeatureTitle.trim()) return;
    setAddingFeature(true);
    try {
      await createFeature(project.id, editing.id, newFeatureTitle.trim());
      setNewFeatureTitle("");
      await features.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setAddingFeature(false);
    }
  };

  const removeFeature = async (f: Feature) => {
    await deleteFeature(project.id, f.id);
    await features.reload();
  };

  const rows = summary.data?.epics ?? [];
  const visible = useMemo(
    () =>
      rows.filter(
        ({ epic }) => (!statusFilter || epic.status === statusFilter) && matches(query, epic.human_id, epic.title, epic.summary),
      ),
    [rows, query, statusFilter],
  );
  const filtered = query.trim() !== "" || statusFilter !== "";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Epics</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New epic
          </button>
        )}
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search epics", label: "Search epics" }}
        filters={[
          {
            label: "Filter by status",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [{ value: "", label: "All statuses" }, ...EPIC_STATUSES.map((s) => ({ value: s, label: s }))],
          },
        ]}
        count={{ visible: visible.length, total: rows.length, noun: ["epic", "epics"] }}
      />

      <ListTable
        columns={[
          {
            header: "Epic",
            className: "primary",
            render: ({ epic }) => (
              <NameCell sub={epic.summary || undefined} to={`/orgs/${orgId}/projects/${project.id}/epics/${epic.id}`}>
                {epic.human_id} · {epic.title}
              </NameCell>
            ),
          },
          { header: "Status", render: ({ epic }) => <span className={`badge ${STATUS_BADGE[epic.status]}`}>{epic.status}</span> },
          {
            header: "Release",
            render: ({ epic }) => (epic.release_id ? releaseById.get(epic.release_id)?.title ?? "—" : <span className="muted">Unscheduled</span>),
          },
          {
            header: "Progress",
            className: "wide",
            render: ({ progress }) => <ProgressBar progress={progress} />,
          },
        ]}
        rows={visible}
        rowKey={({ epic }) => epic.id}
        rowLabel={({ epic }) => epic.title}
        actions={({ epic }) =>
          canWrite
            ? [
                { label: "Edit", onSelect: () => openDrawer(epic) },
                { label: "Delete", danger: true, onSelect: () => setDeleting(epic) },
              ]
            : null
        }
        loading={summary.loading}
        error={summary.error}
        empty={
          filtered ? (
            "No epics match these filters."
          ) : (
            <>
              <b>No epics yet.</b> {canWrite ? "An epic groups the features and requirements for one large body of work." : "Nothing here yet."}
            </>
          )
        }
      />

      <Drawer
        open={drawerOpen}
        title={editing ? `Edit ${editing.human_id}` : "New epic"}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        width={520}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !form.title.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create epic"}
            </button>
          </>
        }
      >
        <Field label="Title">
          <input className="input" required value={form.title} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field label="Summary">
          <textarea className="input textarea" rows={2} value={form.summary} onChange={(e) => patch({ summary: e.target.value })} />
        </Field>
        {editing && (
          <Field label="Status">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as EpicStatus)}>
              {EPIC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Release" hint="Assigning a release here is inherited by every requirement under this epic that has no release of its own.">
          <select className="select" value={form.release_id ?? ""} onChange={(e) => patch({ release_id: e.target.value || null })}>
            <option value="">Unscheduled</option>
            {(releases.data ?? []).map((r: Release) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </Field>

        {editing && (
          <Field label="Features">
            <div className="stack" style={{ gap: 6 }}>
              {(features.data ?? []).length === 0 && <span className="muted">No features yet.</span>}
              {(features.data ?? []).map((f) => (
                <div key={f.id} className="list-editor-row">
                  <span>
                    {f.human_id} · {f.title}
                  </span>
                  <button type="button" className="btn icon ghost" aria-label={`Remove ${f.title}`} onClick={() => removeFeature(f)}>
                    ×
                  </button>
                </div>
              ))}
              <div className="list-editor-row">
                <input
                  className="input"
                  placeholder="e.g. Payment"
                  value={newFeatureTitle}
                  onChange={(e) => setNewFeatureTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addFeature();
                    }
                  }}
                />
                <button type="button" className="btn small ghost" disabled={addingFeature || !newFeatureTitle.trim()} onClick={() => void addFeature()}>
                  Add feature
                </button>
              </div>
            </div>
          </Field>
        )}

        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete epic"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteEpic(project.id, deleting.id);
          await summary.reload();
        }}
      >
        <p>
          Delete <b>{deleting?.title}</b>? Its features go with it; requirements under it or its features are untagged, not deleted.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

function ProgressBar({ progress }: { progress: { done: number; doing: number; total: number; pct: number } }) {
  if (progress.total === 0) return <span className="muted">No requirements yet</span>;
  return (
    <div className="stack" style={{ gap: 2 }}>
      <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress.pct}%`, background: "var(--accent)" }} />
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        {progress.done}/{progress.total} done{progress.doing ? `, ${progress.doing} in progress` : ""} · {progress.pct}%
      </span>
    </div>
  );
}
