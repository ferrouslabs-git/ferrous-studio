// A project's roadmap: releases, and how much of what's tagged to each one
// is done. Each release's epics/requirements live on the Epics and Plan
// pages -- this is the "what's coming, roughly when" overview.
//
// A release's date is derived from its sprints (see releasesApi.ts), not
// something typed in here -- the way to move a release's date is to move
// the sprint that sets it, on the Plan page.
import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatDate } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import {
  createRelease,
  deleteRelease,
  listReleases,
  Release,
  ReleaseCreateInput,
  ReleaseProgress,
  updateRelease,
} from "./releasesApi";

const EMPTY: ReleaseCreateInput = { title: "", description: "" };

// Shipped releases sink to the bottom (most recently shipped first); the
// rest sort by derived date, soonest first, with unscheduled ones last.
// Ported from software-management's releases() (static/js/releases.js).
function sortReleases(list: Release[]): Release[] {
  return [...list].sort((a, b) => {
    if (!!a.shipped_at !== !!b.shipped_at) return a.shipped_at ? 1 : -1;
    if (a.shipped_at && b.shipped_at) return a.shipped_at < b.shipped_at ? 1 : -1;
    return (a.date ?? "9999") < (b.date ?? "9999") ? -1 : 1;
  });
}

type DueTone = "good" | "warn" | "muted";

function dueStatus(r: Release): { tone: DueTone; label: string } {
  if (r.shipped_at) return { tone: "good", label: `Shipped ${formatDate(r.shipped_at)}` };
  if (!r.date) return { tone: "muted", label: "Unscheduled" };
  const days = Math.ceil((new Date(r.date + "T23:59:59").getTime() - Date.now()) / 86400000);
  if (days < 0) return { tone: "warn", label: `${-days}d overdue` };
  if (days === 0) return { tone: "warn", label: "Due today" };
  if (days <= 14) return { tone: "warn", label: `${days}d left` };
  return { tone: "muted", label: `${days}d left` };
}

export function RoadmapPage() {
  const { project, orgId, canWrite } = useProject();
  const planUrl = (releaseId: string) => `/orgs/${orgId}/projects/${project.id}/roadmap/${releaseId}/plan`;
  const releases = useLoad(() => listReleases(project.id), [project.id]);
  const [editing, setEditing] = useState<Release | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Release | null>(null);
  const [form, setForm] = useState<ReleaseCreateInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const patch = (p: Partial<ReleaseCreateInput>) => setForm((f) => ({ ...f, ...p }));

  const openDrawer = (r: Release | null) => {
    setEditing(r);
    setForm(r ? { title: r.title, description: r.description } : EMPTY);
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body: ReleaseCreateInput = { title: form.title.trim(), description: form.description?.trim() || "" };
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

  const toggleShipped = async (r: Release) => {
    await updateRelease(project.id, r.id, { shipped: !r.shipped_at });
    await releases.reload();
  };

  const all = useMemo(() => sortReleases(releases.data ?? []), [releases.data]);
  const visible = useMemo(() => all.filter((r) => matches(query, r.human_id, r.title, r.description)), [all, query]);
  const filtered = query.trim() !== "";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Roadmap</h1>
        <span className="shell-spacer" />
        <Link to={`/orgs/${orgId}/projects/${project.id}/roadmap/unscheduled/plan`} className="btn ghost">
          Unscheduled work
        </Link>
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
              <NameCell sub={r.human_id} to={planUrl(r.id)}>
                {r.title}
              </NameCell>
            ),
          },
          {
            header: "Date",
            className: "when",
            render: (r) =>
              r.date ? (
                <span title="Set by the last sprint filed under this release -- move that sprint to change it.">
                  {formatDate(r.date)}
                </span>
              ) : (
                <span className="muted">No sprints yet</span>
              ),
          },
          {
            header: "Status",
            render: (r) => {
              const due = dueStatus(r);
              return <span className={`badge ${due.tone}`}>{due.label}</span>;
            },
          },
          { header: "Progress", className: "wide", render: (r) => <ProgressBar progress={r.progress} /> },
          { header: "Description", className: "wide muted", render: (r) => r.description || "—" },
        ]}
        rows={visible}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.title}
        actions={(r) =>
          canWrite
            ? [
                { label: "Edit", onSelect: () => openDrawer(r) },
                { label: r.shipped_at ? "Mark not shipped" : "Mark shipped", onSelect: () => toggleShipped(r) },
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
              <b>No releases yet.</b> {canWrite ? "A release groups epics and requirements toward a shippable state." : "Nothing here yet."}
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

function ProgressBar({ progress }: { progress: ReleaseProgress }) {
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
