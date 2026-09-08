// One epic's own page: title/summary/status/release, its attachments and
// docs, and its requirements grouped by feature. Reached by clicking an
// epic on the Epics list. Ported from software-management's epic detail
// page (static/js/epicpage.js), adapted to Ferrous Studio's own components
// rather than its inline-editable vanilla-JS fields.
import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { Release, listReleases } from "../roadmap/releasesApi";
import { AttachmentsSection } from "./AttachmentsSection";
import { CommentsSection } from "./CommentsSection";
import { EPIC_STATUSES, Epic, EpicStatus, getBoardSummary, getEpic, updateEpic } from "./epicsApi";
import { Feature, createFeature, deleteFeature, listFeatures, updateFeature } from "./featuresApi";
import { BoardDoc, BoardDocInput, createBoardDoc, deleteBoardDoc, listBoardDocs, updateBoardDoc } from "./boardDocsApi";
import { MarkdownWithMermaid } from "./MarkdownWithMermaid";
import {
  RequirementInput,
  Requirement,
  createRequirement,
  deleteRequirement,
  listRequirements,
} from "../plan/requirementsApi";

const STATUS_BADGE: Record<EpicStatus, string> = {
  Readiness: "muted",
  Implementation: "accent",
  ReleasedToUAT: "warn",
  HumanValidation: "warn",
  Done: "good",
};

const EMPTY_DOC: BoardDocInput = { title: "", body: "", tags: [], epic_id: null };

export function EpicDetailPage() {
  const { project, orgId, canWrite } = useProject();
  const { epicId = "" } = useParams<{ epicId: string }>();

  const epicLoad = useLoad(() => getEpic(project.id, epicId), [project.id, epicId]);
  const releases = useLoad(() => listReleases(project.id), [project.id]);
  const features = useLoad(() => listFeatures(project.id, epicId), [project.id, epicId]);
  const requirements = useLoad(() => listRequirements(project.id, { epic_id: epicId }), [project.id, epicId]);
  const docs = useLoad(() => listBoardDocs(project.id, epicId), [project.id, epicId]);

  const epic = epicLoad.data;

  const [savingField, setSavingField] = useState<string | null>(null);
  const [docDrawerOpen, setDocDrawerOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<BoardDoc | null>(null);
  const [viewingDoc, setViewingDoc] = useState<BoardDoc | null>(null);
  const [docForm, setDocForm] = useState<BoardDocInput>(EMPTY_DOC);
  const [docSaving, setDocSaving] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<BoardDoc | null>(null);
  const [newFeatureTitle, setNewFeatureTitle] = useState("");

  const saveField = async (patch: Partial<{ title: string; summary: string }>) => {
    if (!epic) return;
    setSavingField(Object.keys(patch)[0]);
    try {
      await updateEpic(project.id, epic.id, patch);
      await epicLoad.reload();
    } finally {
      setSavingField(null);
    }
  };

  const setStatus = async (status: EpicStatus) => {
    if (!epic) return;
    try {
      await updateEpic(project.id, epic.id, { status });
      await epicLoad.reload();
    } catch (err) {
      window.alert(errorMessage(err));
    }
  };

  const setRelease = async (releaseId: string | null) => {
    if (!epic) return;
    await updateEpic(project.id, epic.id, { release_id: releaseId, clear_release: releaseId === null });
    await epicLoad.reload();
  };

  const addFeature = async () => {
    if (!epic || !newFeatureTitle.trim()) return;
    await createFeature(project.id, epic.id, newFeatureTitle.trim());
    setNewFeatureTitle("");
    await features.reload();
  };

  const removeFeature = async (f: Feature) => {
    await deleteFeature(project.id, f.id);
    await Promise.all([features.reload(), requirements.reload()]);
  };

  const addRequirement = async (featureId: string | null) => {
    if (!epic) return;
    const title = window.prompt(featureId ? "New requirement under this feature" : "New requirement directly under this epic");
    if (!title?.trim()) return;
    const body: RequirementInput = {
      title: title.trim(), body: "", epic_id: featureId ? null : epic.id, feature_id: featureId,
      status: "Todo", priority: "Medium", assignee_id: null, release_id: null, sprint_id: null,
    };
    await createRequirement(project.id, body);
    await requirements.reload();
  };

  const removeRequirement = async (r: Requirement) => {
    await deleteRequirement(project.id, r.id);
    await requirements.reload();
  };

  const openDocDrawer = (d: BoardDoc | null) => {
    setEditingDoc(d);
    setDocForm(d ? { title: d.title, body: d.body, tags: d.tags, epic_id: d.epic_id } : { ...EMPTY_DOC, epic_id: epicId });
    setDocError(null);
    setDocDrawerOpen(true);
  };

  const saveDoc = async (e: FormEvent) => {
    e.preventDefault();
    setDocSaving(true);
    setDocError(null);
    try {
      if (editingDoc) await updateBoardDoc(project.id, editingDoc.id, docForm);
      else await createBoardDoc(project.id, docForm);
      setDocDrawerOpen(false);
      await docs.reload();
    } catch (err) {
      setDocError(errorMessage(err));
    } finally {
      setDocSaving(false);
    }
  };

  const releaseById = useMemo(() => new Map((releases.data ?? []).map((r) => [r.id, r])), [releases.data]);
  const directRequirements = useMemo(
    () => (requirements.data ?? []).filter((r) => !r.feature_id),
    [requirements.data],
  );
  const requirementsByFeature = useMemo(() => {
    const m = new Map<string, Requirement[]>();
    for (const r of requirements.data ?? []) {
      if (!r.feature_id) continue;
      m.set(r.feature_id, [...(m.get(r.feature_id) ?? []), r]);
    }
    return m;
  }, [requirements.data]);

  if (epicLoad.loading) return <div className="page muted">Loading…</div>;
  if (!epic) return <div className="page muted">Epic not found.</div>;

  return (
    <div className="page stack">
      <div className="page-head">
        <div className="stack" style={{ gap: 2 }}>
          <Link to={`/orgs/${orgId}/projects/${project.id}/epics`} className="muted" style={{ fontSize: 12 }}>
            ← Epics
          </Link>
          <h1>
            {epic.human_id} · {epic.title}
          </h1>
        </div>
        <span className="shell-spacer" />
        <select
          className="select"
          value={epic.status}
          disabled={!canWrite}
          onChange={(e) => void setStatus(e.target.value as EpicStatus)}
        >
          {EPIC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className={`badge ${STATUS_BADGE[epic.status]}`}>{epic.status}</span>
      </div>

      <div className="section">
        <div className="section-body stack">
          <Field label="Title">
            <input
              className="input"
              defaultValue={epic.title}
              disabled={!canWrite || savingField === "title"}
              onBlur={(e) => e.target.value.trim() !== epic.title && saveField({ title: e.target.value.trim() })}
            />
          </Field>
          <Field label="Description">
            <textarea
              className="input textarea"
              rows={3}
              defaultValue={epic.summary}
              disabled={!canWrite || savingField === "summary"}
              placeholder="What does done look like for this epic?"
              onBlur={(e) => e.target.value.trim() !== epic.summary && saveField({ summary: e.target.value.trim() })}
            />
          </Field>
          <Field label="Release">
            <select className="select" value={epic.release_id ?? ""} disabled={!canWrite} onChange={(e) => void setRelease(e.target.value || null)}>
              <option value="">Unscheduled</option>
              {(releases.data ?? []).map((r: Release) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Attachments</h2>
        </div>
        <div className="section-body">
          <AttachmentsSection projectId={project.id} entityType="epic" entityId={epic.id} canWrite={canWrite} />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Docs</h2>
          <span className="shell-spacer" />
          {canWrite && (
            <button className="btn small ghost" onClick={() => openDocDrawer(null)}>
              + New doc
            </button>
          )}
        </div>
        <div className="section-body stack">
          {(docs.data ?? []).length === 0 && <span className="muted">No docs yet.</span>}
          {(docs.data ?? []).map((d) => (
            <div key={d.id} className="list-editor-row">
              <button type="button" className="btn-link" onClick={() => setViewingDoc(d)}>
                {d.human_id} · {d.title}
              </button>
              {canWrite && (
                <>
                  <button type="button" className="btn small ghost" onClick={() => openDocDrawer(d)}>
                    Edit
                  </button>
                  <button type="button" className="btn icon ghost" aria-label={`Delete ${d.title}`} onClick={() => setDeletingDoc(d)}>
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Comments</h2>
        </div>
        <div className="section-body">
          <CommentsSection projectId={project.id} orgId={orgId} entityType="epic" entityId={epic.id} canWrite={canWrite} />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Requirements ({(requirements.data ?? []).length})</h2>
          <span className="shell-spacer" />
          {canWrite && (
            <button className="btn small ghost" onClick={() => void addRequirement(null)}>
              + Requirement
            </button>
          )}
        </div>
        <div className="section-body stack">
          {directRequirements.length > 0 && (
            <FeatureGroup title="Unassigned" requirements={directRequirements} onAddRequirement={() => void addRequirement(null)} onRemoveRequirement={removeRequirement} canWrite={canWrite} />
          )}
          {(features.data ?? []).map((f) => (
            <FeatureCard
              key={f.id}
              projectId={project.id}
              feature={f}
              requirements={requirementsByFeature.get(f.id) ?? []}
              canWrite={canWrite}
              onRename={(title) => void updateFeature(project.id, f.id, title).then(() => features.reload())}
              onDelete={() => void removeFeature(f)}
              onAddRequirement={() => void addRequirement(f.id)}
              onRemoveRequirement={removeRequirement}
            />
          ))}
          {!directRequirements.length && !(features.data ?? []).length && (
            <span className="muted">No requirements under this epic yet.</span>
          )}
          {canWrite && (
            <div className="list-editor-row">
              <input
                className="input"
                placeholder="e.g. Bulk import"
                value={newFeatureTitle}
                onChange={(e) => setNewFeatureTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addFeature();
                  }
                }}
              />
              <button type="button" className="btn small ghost" disabled={!newFeatureTitle.trim()} onClick={() => void addFeature()}>
                + Feature
              </button>
            </div>
          )}
        </div>
      </section>

      <Drawer
        open={docDrawerOpen}
        title={editingDoc ? `Edit ${editingDoc.human_id}` : "New doc"}
        onClose={() => setDocDrawerOpen(false)}
        onSubmit={saveDoc}
        width={640}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDocDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={docSaving || !docForm.title.trim()}>
              {docSaving ? "Saving…" : editingDoc ? "Save changes" : "Create doc"}
            </button>
          </>
        }
      >
        <Field label="Title">
          <input className="input" required value={docForm.title} onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Body (markdown, ```mermaid fences render as diagrams)">
          <textarea
            className="input textarea"
            rows={14}
            style={{ fontFamily: "monospace" }}
            value={docForm.body}
            onChange={(e) => setDocForm((f) => ({ ...f, body: e.target.value }))}
          />
        </Field>
        {docError && <div className="status-banner warn">{docError}</div>}
      </Drawer>

      <Drawer open={viewingDoc !== null} title={viewingDoc ? `${viewingDoc.human_id} · ${viewingDoc.title}` : ""} onClose={() => setViewingDoc(null)} width={720}>
        {viewingDoc && <MarkdownWithMermaid body={viewingDoc.body} />}
      </Drawer>

      <ConfirmDrawer
        open={deletingDoc !== null}
        title="Delete doc"
        onClose={() => setDeletingDoc(null)}
        onConfirm={async () => {
          if (!deletingDoc) return;
          await deleteBoardDoc(project.id, deletingDoc.id);
          await docs.reload();
        }}
      >
        <p>
          Delete <b>{deletingDoc?.title}</b>? This can't be undone.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

function FeatureGroup({
  title,
  requirements,
  canWrite,
  onAddRequirement,
  onRemoveRequirement,
}: {
  title: string;
  requirements: Requirement[];
  canWrite: boolean;
  onAddRequirement: () => void;
  onRemoveRequirement: (r: Requirement) => void;
}) {
  return (
    <div className="section" style={{ padding: 10 }}>
      <div className="section-head">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="shell-spacer" />
        {canWrite && (
          <button type="button" className="btn mini ghost" onClick={onAddRequirement}>
            + Requirement
          </button>
        )}
      </div>
      {requirements.length === 0 ? (
        <span className="muted">Nothing here yet.</span>
      ) : (
        requirements.map((r) => (
          <div key={r.id} className="list-editor-row">
            <span className="k">{r.human_id}</span>
            <span>{r.title}</span>
            <span className="badge muted">{r.status}</span>
            {canWrite && (
              <button type="button" className="btn icon ghost" aria-label={`Delete ${r.title}`} onClick={() => onRemoveRequirement(r)}>
                ×
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function FeatureCard({
  projectId,
  feature,
  requirements,
  canWrite,
  onRename,
  onDelete,
  onAddRequirement,
  onRemoveRequirement,
}: {
  projectId: string;
  feature: Feature;
  requirements: Requirement[];
  canWrite: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAddRequirement: () => void;
  onRemoveRequirement: (r: Requirement) => void;
}) {
  const [showAttachments, setShowAttachments] = useState(false);
  return (
    <div className="section" style={{ padding: 10 }}>
      <div className="section-head">
        <span className="k">{feature.human_id}</span>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          defaultValue={feature.title}
          disabled={!canWrite}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== feature.title && onRename(e.target.value.trim())}
        />
        <span className="shell-spacer" />
        {canWrite && (
          <>
            <button type="button" className="btn mini ghost" onClick={onAddRequirement}>
              + Requirement
            </button>
            <button
              type="button"
              className="btn mini ghost"
              onClick={() => {
                if (window.confirm(`Delete ${feature.human_id} "${feature.title}"? Its requirements are untagged, not deleted.`)) onDelete();
              }}
              style={{ color: "var(--warn)" }}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {requirements.length === 0 ? (
        <span className="muted">Nothing here yet.</span>
      ) : (
        requirements.map((r) => (
          <div key={r.id} className="list-editor-row">
            <span className="k">{r.human_id}</span>
            <span>{r.title}</span>
            <span className="badge muted">{r.status}</span>
            {canWrite && (
              <button type="button" className="btn icon ghost" aria-label={`Delete ${r.title}`} onClick={() => onRemoveRequirement(r)}>
                ×
              </button>
            )}
          </div>
        ))
      )}
      <button type="button" className="btn-link" style={{ fontSize: 12, marginTop: 6 }} onClick={() => setShowAttachments((v) => !v)}>
        {showAttachments ? "Hide attachments" : "Attachments"}
      </button>
      {showAttachments && (
        <div style={{ marginTop: 6 }}>
          <AttachmentsSection projectId={projectId} entityType="feature" entityId={feature.id} canWrite={canWrite} />
        </div>
      )}
    </div>
  );
}
