// Project details: name, description and rationale, with an Edit drawer,
// followed by the two things filed against the project rather than designed
// in it -- where it is deployed, and which repository it is built from.
import { useState } from "react";
import { ProjectFormDrawer } from "../projects/ProjectFormDrawer";
import { BoardTokensSection } from "./BoardTokensSection";
import { EnvironmentsSection } from "./EnvironmentsSection";
import { ImportBundleDrawer } from "./ImportBundleDrawer";
import { ProjectKeyRow } from "./ProjectKeyRow";
import { RepositorySection } from "./RepositorySection";
import { useProject } from "./ProjectLayout";

export function ProjectDetailsPage() {
  const { project, orgId, canWrite, reload } = useProject();
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const openDrawer = () => setOpen(true);

  const counts = project.counts;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Project details</h1>
        {project.status === "archived" && <span className="badge">archived</span>}
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn ghost" onClick={() => setImporting(true)}>
            Import…
          </button>
        )}
        {canWrite && (
          <button className="btn primary" onClick={openDrawer}>
            Edit
          </button>
        )}
      </div>

      {importing && (
        <ImportBundleDrawer
          projectId={project.id}
          orgId={orgId}
          onClose={() => setImporting(false)}
          onImported={reload}
        />
      )}

      <section className="section">
        <div className="section-body details-grid">
          <DetailRow label="Name">{project.name}</DetailRow>
          <ProjectKeyRow />
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

      <EnvironmentsSection />

      <RepositorySection />

      <BoardTokensSection />

      {/* The same drawer the projects list edits with; it saves as you go. */}
      <ProjectFormDrawer open={open} project={project} onClose={() => setOpen(false)} onSaved={reload} />
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
