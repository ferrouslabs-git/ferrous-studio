// The requirements that are not use cases. A use case says what the system
// does for someone; none of these do, and before this tab (2026-09-18) they
// had nowhere to go but the project description.
//
// Every field is optional and most projects will leave most of them empty --
// an embedded controller cares about the physical setup, a reporting tool
// does not. So there is no validation, no required marker and no completeness
// figure: a blank field means "not asked", never "not answered yet".
//
// Both goals are free text on purpose. "Under 200 ms at the 95th percentile
// on 4G" and "no worse than the manual process" are both real answers to a
// latency goal, and a number could hold neither.
import { useCallback, useRef, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { errorMessage } from "../../../core/api";
import { formatBytes, formatDate } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { updateProject } from "../../projects/projectsApi";
import {
  deleteDocument,
  EXAMPLE_DATA_EXTENSIONS,
  getDownloadUrl,
  listDocuments,
  ProjectDocument,
  uploadDocument,
} from "../documents/documentsApi";
import { useProject } from "../ProjectLayout";

type Field = "physical_setup" | "hosting" | "latency_goal" | "accuracy_goal";

const FIELDS: { key: Field; label: string; placeholder: string }[] = [
  {
    key: "physical_setup",
    label: "Physical setup",
    placeholder: "Where the work happens and what it runs on — a shop floor terminal, a van, a lab bench, a phone in a pocket.",
  },
  { key: "hosting", label: "Hosting", placeholder: "Where the app is to run — a cloud region, on-premises, an existing tenancy." },
  { key: "latency_goal", label: "Latency goal", placeholder: "How fast it has to be, and measured how." },
  { key: "accuracy_goal", label: "Accuracy goal", placeholder: "How right it has to be, and measured against what." },
];

export function OtherRequirementsTab() {
  const { project, canWrite, reload } = useProject();
  const files = useLoad(() => listDocuments(project.id, "example_data"), [project.id]);
  const [saving, setSaving] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Saved on blur, like the epic page's title and description: these are
  // paragraphs someone is thinking through, not a form to submit.
  const save = useCallback(
    async (key: Field, value: string) => {
      const next = value.trim();
      if (next === (project[key] ?? "")) return;
      setSaving(key);
      setError(null);
      try {
        await updateProject(project.id, { [key]: next || null });
        await reload();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSaving(null);
      }
    },
    [project, reload],
  );

  // "This may be an upload of many files": the picker takes a whole folder's
  // worth at once and each one is its own upload, so one failure does not
  // lose the rest.
  const addFiles = async (chosen: FileList | null) => {
    if (!chosen || chosen.length === 0) return;
    const list = Array.from(chosen);
    setError(null);
    setUploading(list.map((f) => f.name));
    const failed: string[] = [];
    for (const file of list) {
      try {
        await uploadDocument(project.id, file, { purpose: "example_data" });
      } catch (err) {
        failed.push(`${file.name} — ${errorMessage(err)}`);
      }
      setUploading((names) => names.filter((n) => n !== file.name));
    }
    setUploading([]);
    if (failed.length) setError(`Could not upload ${failed.length} of ${list.length}: ${failed.join("; ")}`);
    await files.reload();
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

  return (
    <div className="stack">
      {error && <div className="status-banner warn">{error}</div>}

      <div className="section">
        <div className="otherreq-fields">
          {FIELDS.map((f) => (
            <label key={f.key} className="otherreq-field">
              <span className="otherreq-label">
                {f.label}
                {saving === f.key && <small className="muted"> saving…</small>}
              </span>
              <textarea
                className="input textarea"
                rows={3}
                // Uncontrolled and keyed by the project so a reload after a
                // save never moves the caret in a field still being typed in.
                key={`${project.id}:${f.key}:${project[f.key] ?? ""}`}
                defaultValue={project[f.key] ?? ""}
                placeholder={f.placeholder}
                disabled={!canWrite}
                onBlur={(e) => void save(f.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Example data</h2>
          <span className="shell-spacer" />
          {canWrite && (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                accept={EXAMPLE_DATA_EXTENSIONS}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button className="btn" disabled={uploading.length > 0} onClick={() => picker.current?.click()}>
                {uploading.length > 0 ? `Uploading ${uploading.length}…` : "Add files"}
              </button>
            </>
          )}
        </div>

        {files.loading ? (
          <div className="empty">Loading…</div>
        ) : files.error ? (
          <div className="empty error">{files.error}</div>
        ) : (
          <ListTable
            columns={[
              {
                header: "File",
                className: "primary",
                render: (d) => (
                  <NameCell sub={d.status === "pending" ? "still uploading" : undefined} onOpen={() => void download(d)}>
                    {d.filename}
                  </NameCell>
                ),
              },
              { header: "Size", render: (d) => formatBytes(d.size_bytes) },
              { header: "Added", render: (d) => formatDate(d.created_at) },
            ]}
            rows={files.data ?? []}
            rowKey={(d) => d.id}
            rowLabel={(d) => d.filename}
            actions={(d) =>
              canWrite
                ? [
                    { label: "Download", onSelect: () => void download(d) },
                    { label: "Delete", danger: true, onSelect: () => setDeleting(d) },
                  ]
                : [{ label: "Download", onSelect: () => void download(d) }]
            }
            empty={
              <>
                <b>No example data yet.</b>{" "}
                {canWrite ? "Add the files that show what real data looks like." : "Nothing here yet."}
              </>
            }
          />
        )}
      </div>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete file"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteDocument(project.id, deleting.id);
          await files.reload();
        }}
      >
        <p>
          Delete <b>{deleting?.filename}</b>?
        </p>
      </ConfirmDrawer>
    </div>
  );
}
