// A project's uploaded files. Uploads go straight to S3 (see documentsApi);
// the list shows what has been confirmed plus anything still in flight.
import { FormEvent, useRef, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { errorMessage } from "../../../core/api";
import { formatBytes } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import {
  ACCEPTED_EXTENSIONS,
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  ProjectDocument,
  uploadDocument,
  UploadPhase,
} from "./documentsApi";

const PHASE_LABEL: Record<UploadPhase, string> = {
  requesting: "Preparing…",
  uploading: "Uploading…",
  confirming: "Checking…",
};

export function DocumentsPage() {
  const { project, canWrite } = useProject();
  const documents = useLoad(() => listDocuments(project.id), [project.id]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const openDrawer = () => {
    setFile(null);
    setPhase(null);
    setFormError(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    abortRef.current?.abort();
    setDrawerOpen(false);
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setFormError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await uploadDocument(project.id, file, { onPhase: setPhase, signal: controller.signal });
      setDrawerOpen(false);
      await documents.reload();
    } catch (err) {
      if (!controller.signal.aborted) setFormError(errorMessage(err));
    } finally {
      setPhase(null);
      abortRef.current = null;
    }
  };

  const download = async (doc: ProjectDocument) => {
    setError(null);
    try {
      const { url } = await getDownloadUrl(project.id, doc.id);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const list = documents.data ?? [];
  const busy = phase !== null;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Documents</h1>
        <span className="sub">{list.length} in this project</span>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={openDrawer}>
            Upload
          </button>
        )}
      </div>

      {error && <div className="status-banner warn">{error}</div>}

      <section className="section">
        {documents.loading ? (
          <div className="empty">Loading…</div>
        ) : documents.error ? (
          <div className="empty error">{documents.error}</div>
        ) : list.length === 0 ? (
          <div className="empty">
            <b>No documents yet.</b> {canWrite ? "Upload transcripts, briefs or reference material." : "Nothing here yet."}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.status === "uploaded" ? (
                      <button className="btn small ghost" onClick={() => void download(d)}>
                        {d.filename}
                      </button>
                    ) : (
                      <span className="muted">{d.filename}</span>
                    )}
                  </td>
                  <td>
                    <span className="badge">{typeLabel(d)}</span>
                    {d.status === "pending" && <span className="badge warn">uploading</span>}
                  </td>
                  <td className="muted">{formatBytes(d.size_bytes)}</td>
                  <td className="muted">{new Date(d.confirmed_at ?? d.created_at).toLocaleString()}</td>
                  <td className="actions">
                    {d.status === "uploaded" && (
                      <button className="btn small" onClick={() => void download(d)}>
                        Download
                      </button>
                    )}{" "}
                    {canWrite && (
                      <button className="btn small ghost" onClick={() => setDeleting(d)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        title="Upload document"
        description="Transcripts, briefs, reference material. Text, Markdown, PDF, Word and images."
        onClose={closeDrawer}
        onSubmit={upload}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={closeDrawer}>
              {busy ? "Cancel upload" : "Cancel"}
            </button>
            <button className="btn primary" disabled={!file || busy}>
              {busy ? PHASE_LABEL[phase!] : "Upload"}
            </button>
          </>
        }
      >
        <Field label="File" hint="Up to 25 MB.">
          <input
            className="input"
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        {file && (
          <div className="muted" style={{ fontSize: 12 }}>
            {file.name} · {formatBytes(file.size)}
          </div>
        )}
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete document"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteDocument(project.id, deleting.id);
          await documents.reload();
        }}
      >
        <p>
          Permanently delete <b>{deleting?.filename}</b>? This cannot be undone.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

function typeLabel(d: ProjectDocument): string {
  const ext = d.filename.includes(".") ? d.filename.split(".").pop()!.toUpperCase() : "";
  return ext || d.content_type;
}
