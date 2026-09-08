// A project's roadmap: releases, and how much of what's tagged to each one
// is done. Each release's epics/requirements live on the Epics and Plan
// pages -- this is the "what's coming, roughly when" overview.
import { FormEvent, useMemo, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatDate } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { createRelease, deleteRelease, listReleases, Release, ReleaseInput, updateRelease } from "./releasesApi";

const EMPTY: ReleaseInput = { title: "", release_date: null, description: "" };

export function RoadmapPage() {
  const { project, canWrite } = useProject();
  const releases = useLoad(() => listReleases(project.id), [project.id]);
  const [editing, setEditing] = useState<Release | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Release | null>(null);
  const [form, setForm] = useState<ReleaseInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const patch = (p: Partial<ReleaseInput>) => setForm((f) => ({ ...f, ...p }));

  const openDrawer = (r: Release | null) => {
    setEditing(r);
    setForm(r ? { title: r.title, release_date: r.release_date, description: r.description } : EMPTY);
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body: ReleaseInput = {
      title: form.title.trim(),
      release_date: form.release_date || null,
      description: form.description?.trim() || "",
    };
    try {
      if (editing) await updateRelease(project.id, editing.id, body);
      else await createRelease(project.id, body);
      setDrawerOpen(false);
      await releases.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const all = useMemo(
    () => [...(releases.data ?? [])].sort((a, b) => (a.release_date ?? "9999").localeCompare(b.release_date ?? "9999")),
    [releases.data],
  );
  const visible = useMemo(() => all.filter((r) => matches(query, r.human_id, r.title, r.description)), [all, query]);
  const filtered = query.trim() !== "";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Roadmap</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New release
          </button>
        )}
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search releases", label: "Search releases" }}
        count={{ visible: visible.length, total: all.length, noun: ["release", "releases"] }}
      />

      <ListTable
        columns={[
          {
            header: "Release",
            className: "primary",
            render: (r) => (
              <NameCell sub={r.human_id} onOpen={canWrite ? () => openDrawer(r) : undefined}>
                {r.title}
              </NameCell>
            ),
          },
          { header: "Date", className: "when", render: (r) => (r.release_date ? formatDate(r.release_date) : <span className="muted">Unscheduled</span>) },
          { header: "Description", className: "wide muted", render: (r) => r.description || "—" },
        ]}
        rows={visible}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.title}
        actions={(r) =>
          canWrite
            ? [
                { label: "Edit", onSelect: () => openDrawer(r) },
                { label: "Delete", danger: true, onSelect: () => setDeleting(r) },
              ]
            : null
        }
        loading={releases.loading}
        error={releases.error}
        empty={
          filtered ? (
            "No releases match this search."
          ) : (
            <>
              <b>No releases yet.</b> {canWrite ? "A release groups epics and requirements around a rough date." : "Nothing here yet."}
            </>
          )
        }
      />

      <Drawer
        open={drawerOpen}
        title={editing ? "Edit release" : "New release"}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !form.title.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create release"}
            </button>
          </>
        }
      >
        <Field label="Title">
          <input className="input" required placeholder="e.g. v1.0" value={form.title} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field label="Target date" hint="Optional -- a rough date, not a commitment.">
          <input className="input" type="date" value={form.release_date ?? ""} onChange={(e) => patch({ release_date: e.target.value || null })} />
        </Field>
        <Field label="Description">
          <textarea className="input textarea" rows={3} value={form.description} onChange={(e) => patch({ description: e.target.value })} />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete release"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteRelease(project.id, deleting.id);
          await releases.reload();
        }}
      >
        <p>
          Delete <b>{deleting?.title}</b>? Epics and requirements tagged to it are untagged, not deleted.
        </p>
      </ConfirmDrawer>
    </div>
  );
}
