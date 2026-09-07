// Project details: name, description and rationale, with an Edit drawer.
import { FormEvent, useState } from "react";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { updateProject } from "../projects/projectsApi";
import { RepositorySection } from "./RepositorySection";
import { useProject } from "./ProjectLayout";

export function ProjectDetailsPage() {
  const { project, canWrite, reload } = useProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openDrawer = () => {
    setName(project.name);
    setDescription(project.description ?? "");
    setRationale(project.rationale ?? "");
    setFormError(null);
    setOpen(true);
  };

  const unchanged =
    name.trim() === project.name &&
    description.trim() === (project.description ?? "") &&
    rationale.trim() === (project.rationale ?? "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await updateProject(project.id, {
        name: name.trim(),
        description: description.trim() || null,
        rationale: rationale.trim() || null,
      });
      setOpen(false);
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const counts = project.counts;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Project details</h1>
        {project.status === "archived" && <span className="badge">archived</span>}
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={openDrawer}>
            Edit
          </button>
        )}
      </div>

      <section className="section">
        <div className="section-body details-grid">
          <DetailRow label="Name">{project.name}</DetailRow>
          <DetailRow label="Description">
            {project.description ? <Prose text={project.description} /> : <span className="muted">Not set</span>}
          </DetailRow>
          <DetailRow label="Rationale">
            {project.rationale ? <Prose text={project.rationale} /> : <span className="muted">Not set</span>}
          </DetailRow>
          <DetailRow label="Contents">
            <span className="muted">
              {counts.personas} personas · {counts.diagrams} diagrams · {counts.wireframes} wireframes ·{" "}
              {counts.documents} documents
            </span>
          </DetailRow>
          <DetailRow label="Created">
            <span className="muted">{new Date(project.created_at).toLocaleString()}</span>
          </DetailRow>
          <DetailRow label="Updated">
            <span className="muted">{new Date(project.updated_at).toLocaleString()}</span>
          </DetailRow>
        </div>
      </section>

      <RepositorySection />

      <Drawer
        open={open}
        title="Edit project"
        description="Sections and their contents are unaffected."
        onClose={() => setOpen(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !name.trim() || unchanged}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="What the project covers.">
          <textarea className="input textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Rationale" hint="Why the project exists: the problem, the outcome sought.">
          <textarea className="input textarea" rows={5} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="details-label">{label}</div>
      <div className="details-value">{children}</div>
    </>
  );
}

/** Multi-line text, paragraph per blank-line-separated block. */
function Prose({ text }: { text: string }) {
  return (
    <div className="prose">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </div>
  );
}
