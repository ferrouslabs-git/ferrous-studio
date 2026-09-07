// A project's use case model: the user types (actors) and the actions each
// can perform (use cases). Three sub-tabs under the title — Diagram, User
// types, Use cases — driven by ?tab= so a tab can be linked to. The New
// buttons live in the page head so they are reachable from every tab. The
// diagram is drawn from the two lists on every render, never stored.
import { FormEvent, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { Badges, ListTable, NameCell } from "../../../components/ListTable";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { DiagramState, INITIAL_DIAGRAM_STATE, useAutoColumns, UseCaseDiagram, UseCaseDiagramControls } from "./UseCaseDiagram";
import {
  createActor,
  createUseCase,
  deleteActor,
  deleteUseCase,
  listActors,
  listUseCases,
  updateActor,
  updateUseCase,
  UseCase,
  UseCaseActor,
  UseCaseActorInput,
  UseCaseInput,
} from "./useCasesApi";

const EMPTY_ACTOR: UseCaseActorInput = { name: "", description: "" };
const EMPTY_CASE: UseCaseInput = { name: "", description: "", actor_ids: [] };

type Tab = "diagram" | "actors" | "usecases";
const TABS: { id: Tab; label: string }[] = [
  { id: "diagram", label: "Diagram" },
  { id: "actors", label: "User types" },
  { id: "usecases", label: "Use cases" },
];

type Deleting = { kind: "actor"; item: UseCaseActor } | { kind: "usecase"; item: UseCase } | null;

export function UseCaseDiagramPage() {
  const { project, canWrite } = useProject();
  const actors = useLoad(() => listActors(project.id), [project.id]);
  const useCases = useLoad(() => listUseCases(project.id), [project.id]);

  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : "diagram";
  const selectTab = (t: Tab) => setParams(t === "diagram" ? {} : { tab: t }, { replace: true });

  const [actorDrawer, setActorDrawer] = useState(false);
  const [editingActor, setEditingActor] = useState<UseCaseActor | null>(null);
  const [actorForm, setActorForm] = useState<UseCaseActorInput>(EMPTY_ACTOR);

  const [caseDrawer, setCaseDrawer] = useState(false);
  const [editingCase, setEditingCase] = useState<UseCase | null>(null);
  const [caseForm, setCaseForm] = useState<UseCaseInput>(EMPTY_CASE);

  const [diagram, setDiagram] = useState<DiagramState>(INITIAL_DIAGRAM_STATE);
  const [diagramWidth, setDiagramWidth] = useState<number | undefined>(undefined);
  const onDiagramWidth = useCallback((w: number | undefined) => setDiagramWidth(w), []);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);

  const actorList = actors.data ?? [];
  const caseList = useCases.data ?? [];
  const actorName = useMemo(() => new Map(actorList.map((a) => [a.id, a.name])), [actorList]);
  const autoColumns = useAutoColumns(actorList, caseList, diagram, diagramWidth);

  const openActor = (a: UseCaseActor | null) => {
    setEditingActor(a);
    setActorForm(a ? { name: a.name, description: a.description ?? "" } : EMPTY_ACTOR);
    setFormError(null);
    setActorDrawer(true);
  };

  const openCase = (u: UseCase | null) => {
    setEditingCase(u);
    setCaseForm(u ? { name: u.name, description: u.description ?? "", actor_ids: u.actor_ids } : EMPTY_CASE);
    setFormError(null);
    setCaseDrawer(true);
  };

  const saveActor = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body: UseCaseActorInput = { name: actorForm.name.trim(), description: actorForm.description?.trim() || null };
    try {
      if (editingActor) await updateActor(project.id, editingActor.id, body);
      else await createActor(project.id, body);
      setActorDrawer(false);
      await actors.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveCase = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body: UseCaseInput = {
      name: caseForm.name.trim(),
      description: caseForm.description?.trim() || null,
      actor_ids: caseForm.actor_ids,
    };
    try {
      if (editingCase) await updateUseCase(project.id, editingCase.id, body);
      else await createUseCase(project.id, body);
      setCaseDrawer(false);
      await useCases.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActor = (id: string) =>
    setCaseForm((f) => ({
      ...f,
      actor_ids: f.actor_ids.includes(id) ? f.actor_ids.filter((x) => x !== id) : [...f.actor_ids, id],
    }));

  const loading = actors.loading || useCases.loading;
  const error = actors.error ?? useCases.error;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Use case diagram</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <div className="page-head-actions">
            <button className="btn" onClick={() => openActor(null)}>
              New user type
            </button>
            <button
              className="btn primary"
              onClick={() => openCase(null)}
              disabled={actorList.length === 0}
              title={actorList.length === 0 ? "Add a user type first" : undefined}
            >
              New use case
            </button>
          </div>
        )}
      </div>

      <div className="page-subtabs" role="tablist" aria-label="Use case model">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`page-subtab${tab === t.id ? " active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {t.id === "actors" && <span className="page-subtab-count">{actorList.length}</span>}
            {t.id === "usecases" && <span className="page-subtab-count">{caseList.length}</span>}
          </button>
        ))}
        {tab === "diagram" && actorList.length > 0 && (
          <>
            <span className="shell-spacer" />
            <UseCaseDiagramControls actors={actorList} state={diagram} onChange={setDiagram} autoColumns={autoColumns} />
          </>
        )}
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : error ? (
        <div className="empty error">{error}</div>
      ) : tab === "diagram" ? (
        actorList.length === 0 && caseList.length === 0 ? (
          <div className="empty">
            <b>No user types yet.</b>{" "}
            {canWrite ? "Start with who uses the system, then add what each of them can do." : "Nothing here yet."}
          </div>
        ) : (
          <UseCaseDiagram
            systemName={project.name}
            actors={actorList}
            useCases={caseList}
            state={diagram}
            onChange={setDiagram}
            onWidth={onDiagramWidth}
          />
        )
      ) : tab === "actors" ? (
        <ActorsTable
          actors={actorList}
          useCases={caseList}
          canWrite={canWrite}
          onEdit={openActor}
          onDelete={(a) => setDeleting({ kind: "actor", item: a })}
        />
      ) : (
        <UseCasesTable
          useCases={caseList}
          actorName={actorName}
          hasActors={actorList.length > 0}
          canWrite={canWrite}
          onEdit={openCase}
          onDelete={(u) => setDeleting({ kind: "usecase", item: u })}
        />
      )}

      <Drawer
        open={actorDrawer}
        title={editingActor ? "Edit user type" : "New user type"}
        description="A role that interacts with the system — a person, an organisation or another system."
        onClose={() => setActorDrawer(false)}
        onSubmit={saveActor}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setActorDrawer(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !actorForm.name.trim()}>
              {saving ? "Saving…" : editingActor ? "Save changes" : "Create user type"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input
            className="input"
            required
            placeholder="e.g. Customer, Administrator, Payment gateway"
            value={actorForm.name}
            onChange={(e) => setActorForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="Description" hint="Who they are and why they use the system.">
          <textarea
            className="input textarea"
            rows={3}
            value={actorForm.description ?? ""}
            onChange={(e) => setActorForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <Drawer
        open={caseDrawer}
        title={editingCase ? "Edit use case" : "New use case"}
        description="One thing a user can do with the system, named as a verb phrase."
        onClose={() => setCaseDrawer(false)}
        onSubmit={saveCase}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setCaseDrawer(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !caseForm.name.trim()}>
              {saving ? "Saving…" : editingCase ? "Save changes" : "Create use case"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input
            className="input"
            required
            placeholder="e.g. Place an order"
            value={caseForm.name}
            onChange={(e) => setCaseForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="input textarea"
            rows={3}
            value={caseForm.description ?? ""}
            onChange={(e) => setCaseForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        <Field label="Who can perform it" hint="Tick every user type that can carry out this action.">
          <div className="usecase-checklist">
            {actorList.map((a) => (
              <label key={a.id} className="usecase-check">
                <input type="checkbox" checked={caseForm.actor_ids.includes(a.id)} onChange={() => toggleActor(a.id)} />
                <span>{a.name}</span>
              </label>
            ))}
          </div>
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title={deleting?.kind === "actor" ? "Delete user type" : "Delete use case"}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          if (deleting.kind === "actor") {
            await deleteActor(project.id, deleting.item.id);
            await Promise.all([actors.reload(), useCases.reload()]);
          } else {
            await deleteUseCase(project.id, deleting.item.id);
            await useCases.reload();
          }
        }}
      >
        <p>
          Delete <b>{deleting?.item.name}</b>?{" "}
          {deleting?.kind === "actor" ? "Use cases they could perform are kept but lose the link." : ""}
        </p>
      </ConfirmDrawer>
    </div>
  );
}

function ActorsTable({
  actors,
  useCases,
  canWrite,
  onEdit,
  onDelete,
}: {
  actors: UseCaseActor[];
  useCases: UseCase[];
  canWrite: boolean;
  onEdit: (a: UseCaseActor) => void;
  onDelete: (a: UseCaseActor) => void;
}) {
  return (
    <ListTable
      columns={[
        {
          header: "User type",
          className: "primary",
          render: (a) => (
            <NameCell sub={a.description || undefined} onOpen={canWrite ? () => onEdit(a) : undefined}>
              {a.name}
            </NameCell>
          ),
        },
        {
          header: "Can perform",
          render: (a) => {
            const performs = useCases.filter((u) => u.actor_ids.includes(a.id));
            return performs.length === 0 ? (
              <span className="muted">No use cases yet</span>
            ) : (
              <Badges>
                {performs.map((u) => (
                  <span key={u.id} className="badge muted">
                    {u.name}
                  </span>
                ))}
              </Badges>
            );
          },
        },
      ]}
      rows={actors}
      rowKey={(a) => a.id}
      rowLabel={(a) => a.name}
      actions={(a) =>
        canWrite
          ? [
              { label: "Edit", onSelect: () => onEdit(a) },
              { label: "Delete", danger: true, onSelect: () => onDelete(a) },
            ]
          : null
      }
      empty={
        <>
          <b>No user types yet.</b> {canWrite ? "Add the roles that interact with the system." : "Nothing here yet."}
        </>
      }
    />
  );
}

function UseCasesTable({
  useCases,
  actorName,
  hasActors,
  canWrite,
  onEdit,
  onDelete,
}: {
  useCases: UseCase[];
  actorName: Map<string, string>;
  hasActors: boolean;
  canWrite: boolean;
  onEdit: (u: UseCase) => void;
  onDelete: (u: UseCase) => void;
}) {
  return (
    <ListTable
      columns={[
        {
          header: "Use case",
          className: "primary",
          render: (u) => (
            <NameCell sub={u.description || undefined} onOpen={canWrite ? () => onEdit(u) : undefined}>
              {u.name}
            </NameCell>
          ),
        },
        {
          header: "Performed by",
          render: (u) =>
            u.actor_ids.length === 0 ? (
              <span className="badge warn">No user type</span>
            ) : (
              <Badges>
                {u.actor_ids.map((id) => (
                  <span key={id} className="badge accent">
                    {actorName.get(id) ?? "Unknown"}
                  </span>
                ))}
              </Badges>
            ),
        },
      ]}
      rows={useCases}
      rowKey={(u) => u.id}
      rowLabel={(u) => u.name}
      actions={(u) =>
        canWrite
          ? [
              { label: "Edit", onSelect: () => onEdit(u) },
              { label: "Delete", danger: true, onSelect: () => onDelete(u) },
            ]
          : null
      }
      empty={
        <>
          <b>No use cases yet.</b>{" "}
          {!canWrite ? "Nothing here yet." : hasActors ? "Add the actions the system offers." : "Add a user type first."}
        </>
      }
    />
  );
}
