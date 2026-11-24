// A project's usability studies. A study is one round of testing and holds
// everything about it: what is tested, who takes part, what was captured and
// the insights. Cloning one is how its protocol, tasks and script are reused.
import { FormEvent, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatDate } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { cloneStudy, createStudy, deleteStudy, listStudies, StudyExport, StudySummary } from "./usabilityApi";
import { parseStudyFile } from "./usabilityModel";

export function UsabilityPage() {
  const { project, canWriteBoard } = useProject();
  const navigate = useNavigate();
  const studies = useLoad(() => listStudies(project.id), [project.id]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<{ from: StudyExport | null } | null>(null);
  const [cloning, setCloning] = useState<StudySummary | null>(null);
  const [deleting, setDeleting] = useState<StudySummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const all = studies.data ?? [];
  const visible = useMemo(() => all.filter((s) => matches(query, s.name, s.persona)), [all, query]);
  const open = (id: string) => navigate(id);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    const parsed = parseStudyFile(await file.text());
    if ("error" in parsed) setImportError(parsed.error);
    else setCreating({ from: parsed });
    if (picker.current) picker.current.value = "";
  };

  if (!canWriteBoard) {
    return (
      <div className="page stack">
        <div className="page-head">
          <h1>Usability testing</h1>
        </div>
        <div className="empty">
          <b>Usability studies are run by organisation admins.</b> Ask an admin if you need to see a study's results.
        </div>
      </div>
    );
  }

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Usability testing</h1>
        <span className="shell-spacer" />
        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Study file to import"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
        <button className="btn ghost" onClick={() => picker.current?.click()}>
          Import study
        </button>
        <button className="btn primary" onClick={() => setCreating({ from: null })}>
          New study
        </button>
      </div>
      {importError && (
        <div className="usab-warning" role="alert">
          {importError}
        </div>
      )}

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by name or persona", label: "Search studies" }}
        count={{ visible: visible.length, total: all.length, noun: ["study", "studies"] }}
      />

      <ListTable
        columns={[
          {
            header: "Study",
            className: "primary",
            render: (s) => (
              <NameCell sub={s.persona || undefined} onOpen={() => open(s.id)}>
                {s.name}
              </NameCell>
            ),
          },
          {
            header: "Status",
            render: (s) => <span className={`badge ${s.status === "open" ? "good" : ""}`}>{s.status === "open" ? "Open" : "Closed"}</span>,
          },
          { header: "Tasks", className: "num", render: (s) => s.task_count },
          { header: "Participants", className: "num", render: (s) => s.participants },
          { header: "Finished", className: "num", render: (s) => s.completed },
          { header: "Created", className: "when", render: (s) => formatDate(s.created_at) },
        ]}
        rows={visible}
        rowKey={(s) => s.id}
        rowLabel={(s) => s.name}
        actions={(s) => [
          { label: "Open", onSelect: () => open(s.id) },
          { label: "Clone", onSelect: () => setCloning(s) },
          { label: "Delete", danger: true, onSelect: () => setDeleting(s) },
        ]}
        loading={studies.loading}
        error={studies.error}
        empty={
          query.trim() ? (
            "No studies match this search."
          ) : (
            <>
              <b>No studies yet.</b> Create one, then add its tasks and its participants.
            </>
          )
        }
      />

      {creating && (
        <NameDrawer
          title={creating.from ? "Import study" : "New study"}
          description={
            creating.from
              ? `${creating.from.content.tasks?.length ?? 0} tasks and ${creating.from.files.length} files will be imported.`
              : "A round of testing. It starts with a protocol, a consent form and a moderator's script you can change."
          }
          initial={creating.from?.name ?? ""}
          action={creating.from ? "Import study" : "Create study"}
          onClose={() => setCreating(null)}
          onSubmit={async (name) => {
            const study = await createStudy(project.id, creating.from ? { ...creating.from, name } : { name });
            open(study.id);
          }}
        />
      )}
      {cloning && (
        <NameDrawer
          title="Clone study"
          description="The copy has this study's protocol, consent form, tasks, files and script, and no participants."
          initial={`${cloning.name} (copy)`}
          action="Clone study"
          onClose={() => setCloning(null)}
          onSubmit={async (name) => {
            const study = await cloneStudy(project.id, cloning.id, name);
            open(study.id);
          }}
        />
      )}
      <ConfirmDrawer
        open={deleting !== null}
        title="Delete study"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteStudy(project.id, deleting.id);
          await studies.reload();
        }}
      >
        <p>
          Delete <b>{deleting?.name}</b>? Its {deleting?.participants ?? 0} participants, everything captured for them and
          the study's insights are deleted with it, and their links stop working.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

/** Ask for a name, then do something that needs one. */
function NameDrawer({
  title,
  description,
  initial,
  action,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  initial: string;
  action: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || !name.trim()}>
            {saving ? "Working…" : action}
          </button>
        </>
      }
    >
      <Field label="Name" error={error ?? undefined}>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Drawer>
  );
}
