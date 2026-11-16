// High fidelity design: the project's designs. A design is a brief -- one,
// several or all of the project's wireframes, a name, aesthetics text and
// reference images -- that a Claude
// Code skill turns into a prototype in Figma Make. This page files designs
// and edits their briefs; it never edits a design (docs/high-fidelity-design.md).
import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatBytes, formatDateTime } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import {
  deleteDocument,
  DESIGN_REFERENCE_EXTENSIONS,
  listDocuments,
  ProjectDocument,
  uploadDocument,
} from "../documents/documentsApi";
import { useProject } from "../ProjectLayout";
import { listWireframes, Wireframe } from "../wireframes/wireframesApi";
import { createDesign, deleteDesign, Design, listDesigns, updateDesign, wireframeSummary } from "./designsApi";
import { DesignStatusBadge } from "./DesignStatusBadge";
import { useRefetchOnFocus } from "./useRefetchOnFocus";

/** Must agree with ReferenceDocumentIds on the server. */
const MAX_REFERENCES = 12;

type StatusFilter = "active" | "archived" | "all";

/**
 * Create a design, or edit one's brief. Reference images are uploaded when
 * the form is saved, not when they are picked, so cancelling leaves nothing
 * behind.
 */
function DesignDrawer({
  projectId,
  design,
  wireframes,
  references,
  onSaved,
  onClose,
}: {
  projectId: string;
  design: Design | null;
  wireframes: Wireframe[];
  references: ProjectDocument[];
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [allWireframes, setAllWireframes] = useState(design?.all_wireframes ?? true);
  const [picked, setPicked] = useState<string[]>(() => design?.wireframe_ids ?? []);
  // Archived wireframes stay listed while picked, so editing a brief never
  // drops one silently.
  const choices = wireframes.filter((w) => w.status === "active" || picked.includes(w.id));
  const gone = picked.filter((id) => !wireframes.some((w) => w.id === id));
  const togglePicked = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const wireframesChosen = allWireframes || picked.length > 0;
  const [name, setName] = useState(design?.name ?? "");
  const [brief, setBrief] = useState(design?.brief ?? "");
  /** Reference images already on the design that are being kept. */
  const [kept, setKept] = useState<ProjectDocument[]>(() =>
    (design?.reference_document_ids ?? [])
      .map((id) => references.find((d) => d.id === id))
      .filter((d): d is ProjectDocument => !!d),
  );
  const [added, setAdded] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const room = MAX_REFERENCES - kept.length - added.length;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const uploaded: ProjectDocument[] = [];
    try {
      for (const [i, file] of added.entries()) {
        setBusy(`Uploading image ${i + 1} of ${added.length}…`);
        uploaded.push(await uploadDocument(projectId, file, { purpose: "design_reference" }));
      }
      setBusy("Saving…");
      const referenceIds = [...kept, ...uploaded].map((d) => d.id);
      // Deleted wireframes are dropped from the choice when it is saved.
      const choice = {
        all_wireframes: allWireframes,
        wireframe_ids: allWireframes ? [] : picked.filter((id) => !gone.includes(id)),
      };
      if (design) {
        await updateDesign(projectId, design.id, {
          ...choice,
          name: name.trim(),
          brief,
          reference_document_ids: referenceIds,
        });
        // Images taken off the brief belong to nothing else; failing to remove
        // one leaves an unused file, not a wrong brief.
        const dropped = design.reference_document_ids.filter((id) => !referenceIds.includes(id));
        await Promise.allSettled(dropped.map((id) => deleteDocument(projectId, id)));
      } else {
        await createDesign(projectId, {
          ...choice,
          name: name.trim(),
          brief,
          reference_document_ids: referenceIds,
        });
      }
      onClose();
      await onSaved();
    } catch (err) {
      // Nothing was saved, so the images uploaded for it are not on any brief.
      await Promise.allSettled(uploaded.map((d) => deleteDocument(projectId, d.id)));
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      open
      title={design ? "Edit design" : "New design"}
      onClose={busy ? () => undefined : onClose}
      onSubmit={save}
      width={520}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={!!busy || !name.trim() || !wireframesChosen}>
            {busy ?? (design ? "Save" : "Create design")}
          </button>
        </>
      }
    >
      <Field label="Wireframes">
        <select
          className="select"
          value={allWireframes ? "all" : "chosen"}
          onChange={(e) => setAllWireframes(e.target.value === "all")}
        >
          <option value="all">All wireframes</option>
          <option value="chosen">Choose wireframes</option>
        </select>
      </Field>
      {!allWireframes && (
        <div className="check-list" role="group" aria-label="Wireframes to send">
          {choices.length === 0 && <span className="muted">This project has no wireframes yet.</span>}
          {choices.map((w) => (
            <label key={w.id} className="check-item">
              <input type="checkbox" checked={picked.includes(w.id)} onChange={() => togglePicked(w.id)} />
              <span>{w.name}</span>
              {w.status === "archived" && <span className="badge">Archived</span>}
            </label>
          ))}
          {gone.length > 0 && (
            <span className="muted">
              {gone.length === 1 ? "1 picked wireframe was deleted." : `${gone.length} picked wireframes were deleted.`}
            </span>
          )}
        </div>
      )}
      <Field label="Name">
        <input className="input" required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Aesthetics brief">
        <textarea
          className="input textarea"
          rows={9}
          maxLength={20000}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
      </Field>
      <Field label="Reference images">
        <input
          className="input"
          type="file"
          multiple
          accept={DESIGN_REFERENCE_EXTENSIONS}
          disabled={!!busy || room <= 0}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            setAdded((files) => [...files, ...picked].slice(0, MAX_REFERENCES - kept.length));
            e.target.value = "";
          }}
        />
      </Field>
      {(kept.length > 0 || added.length > 0) && (
        <ul className="design-references">
          {kept.map((doc) => (
            <li key={doc.id}>
              <span className="design-reference-name">{doc.filename}</span>
              <span className="muted">{formatBytes(doc.size_bytes)}</span>
              <button
                type="button"
                className="btn small ghost"
                disabled={!!busy}
                aria-label={`Remove ${doc.filename}`}
                onClick={() => setKept((docs) => docs.filter((d) => d.id !== doc.id))}
              >
                Remove
              </button>
            </li>
          ))}
          {added.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              <span className="design-reference-name">{file.name}</span>
              <span className="muted">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="btn small ghost"
                disabled={!!busy}
                aria-label={`Remove ${file.name}`}
                onClick={() => setAdded((files) => files.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {formError && <div className="status-banner warn">{formError}</div>}
    </Drawer>
  );
}

export function HighFidelityDesignPage() {
  const { project, orgId, canWrite } = useProject();
  const navigate = useNavigate();
  const data = useLoad(
    () =>
      Promise.all([listDesigns(project.id), listWireframes(project.id), listDocuments(project.id, "design_reference")]),
    [project.id],
  );
  // A sync run in Claude Code changes a design's status from outside the app.
  useRefetchOnFocus(data.reload);

  const [drawer, setDrawer] = useState<{ design: Design | null } | null>(null);
  const [deleting, setDeleting] = useState<Design | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [designs, wireframes, references] = data.data ?? [[], [], []];
  const base = `/orgs/${orgId}/projects/${project.id}/high-fidelity-design`;

  const visible = useMemo(
    () =>
      designs.filter(
        (d) =>
          (statusFilter === "all" || d.status === statusFilter) &&
          matches(
            query,
            d.name,
            ...(d.all_wireframes
              ? ["All wireframes"]
              : d.wireframe_ids.map((id) => wireframes.find((w) => w.id === id)?.name)),
          ),
      ),
    [designs, wireframes, query, statusFilter],
  );
  const filtered = query.trim() !== "" || statusFilter !== "active";

  const toast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 2200);
  };

  // Archiving is reversible, so no confirmation; the toast matters because
  // with the filter on Active an archived row vanishes.
  const toggleArchived = async (design: Design) => {
    setActionError(null);
    const restoring = design.status === "archived";
    try {
      await updateDesign(project.id, design.id, { status: restoring ? "active" : "archived" });
      await data.reload();
      toast(`${restoring ? "Restored" : "Archived"} "${design.name}"`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>High fidelity design</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => setDrawer({ design: null })} disabled={!data.data}>
            New design
          </button>
        )}
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by name or wireframe", label: "Search designs" }}
        filters={[
          {
            label: "Filter by status",
            value: statusFilter,
            defaultValue: "active",
            onChange: (value) => setStatusFilter(value as StatusFilter),
            options: [
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
              { value: "all", label: "All" },
            ],
          },
        ]}
        count={{ visible: visible.length, total: designs.length, noun: ["design", "designs"] }}
      />

      {actionError && (
        <div className="status-banner warn">
          {actionError}{" "}
          <button className="btn small ghost" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <ListTable
        columns={[
          {
            header: "Design",
            className: "primary",
            render: (d) => (
              <NameCell to={`${base}/${d.id}`} sub={wireframeSummary(d, wireframes)}>
                {d.name}
              </NameCell>
            ),
          },
          {
            header: "Status",
            render: (d) => (
              <span className="chips">
                <DesignStatusBadge design={d} />
                {d.status === "archived" && <span className="badge">Archived</span>}
              </span>
            ),
          },
          {
            header: "Last synced",
            className: "when muted",
            render: (d) => (d.synced_at ? formatDateTime(d.synced_at) : "—"),
          },
        ]}
        rows={visible}
        rowKey={(d) => d.id}
        rowLabel={(d) => d.name}
        actions={(d) => [
          { label: "Open", onSelect: () => navigate(`${base}/${d.id}`) },
          ...(canWrite
            ? [
                { label: "Edit", onSelect: () => setDrawer({ design: d }) },
                { label: d.status === "archived" ? "Restore" : "Archive", onSelect: () => void toggleArchived(d) },
                // Hard delete only once archived -- archiving is the
                // reversible step in front of it.
                ...(d.status === "archived" ? [{ label: "Delete", danger: true, onSelect: () => setDeleting(d) }] : []),
              ]
            : []),
        ]}
        loading={data.loading}
        error={data.error}
        empty={
          designs.length > 0 || filtered ? (
            "No designs match the current search and filter."
          ) : (
            <>
              <b>No designs yet.</b>{" "}
              {canWrite ? "Create one from your wireframes and an aesthetics brief." : "Nothing here yet."}
            </>
          )
        }
      />

      {drawer && (
        <DesignDrawer
          key={drawer.design?.id ?? "new"}
          projectId={project.id}
          design={drawer.design}
          wireframes={wireframes}
          references={references}
          onSaved={data.reload}
          onClose={() => setDrawer(null)}
        />
      )}

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete design"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteDesign(project.id, deleting.id);
          await data.reload();
          toast(`Deleted "${deleting.name}"`);
        }}
      >
        <p>
          Permanently delete <b>{deleting?.name}</b>? Its brief, reference images and every revision held in Studio are
          deleted with it. The Figma Make file is not touched. This cannot be undone.
        </p>
      </ConfirmDrawer>

      <div className={`toast${toastMsg ? " show" : ""}`}>{toastMsg}</div>
    </div>
  );
}
