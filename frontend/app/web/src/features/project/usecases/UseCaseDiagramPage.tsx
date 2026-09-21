// A project's use case model: the actors outside the system and the actions
// the system offers. Four sub-tabs under the title — Diagram, Actors, Use
// cases, Other requirements — driven by ?tab= so a tab can be linked to. The
// New buttons live in the page head and are hidden on the tab that has
// nothing to create. The diagram is drawn from the two lists on every
// render, never stored.
//
// The fourth tab holds what a use case cannot say: the physical setup, where
// it is hosted, the latency and accuracy goals, and example data files.
//
// Neither list needs the other (2026-09-18). An actor is a person, another
// system or time, each drawn its own way; a use case with no actor at all is
// something the system does of its own accord, which is a real thing to
// record and used to be impossible to create.
import { FormEvent, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { Badges, ListTable, NameCell } from "../../../components/ListTable";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { OtherRequirementsTab } from "./OtherRequirementsTab";
import { DiagramState, INITIAL_DIAGRAM_STATE, useAutoColumns, UseCaseDiagram, UseCaseDiagramControls } from "./UseCaseDiagram";
import {
  ACTOR_KIND_LABEL,
  ACTOR_KINDS,
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
  UseCaseActorKind,
  UseCaseInput,
} from "./useCasesApi";

const EMPTY_ACTOR: UseCaseActorInput = { name: "", description: "", kind: "person" };
const EMPTY_CASE: UseCaseInput = { name: "", description: "", actor_ids: [] };

type Tab = "diagram" | "actors" | "usecases" | "other";
const TABS: { id: Tab; label: string }[] = [
  { id: "diagram", label: "Diagram" },
  { id: "actors", label: "Actors" },
  { id: "usecases", label: "Use cases" },
  { id: "other", label: "Other requirements" },
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
    setActorForm(a ? { name: a.name, description: a.description ?? "", kind: a.kind } : EMPTY_ACTOR);
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
    const body: UseCaseActorInput = {
      name: actorForm.name.trim(),
      description: actorForm.description?.trim() || null,
      kind: actorForm.kind,
    };
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
        {canWrite && tab !== "other" && (
          <div className="page-head-actions">
            <button className="btn" onClick={() => openActor(null)}>
              New actor
            </button>
            <button className="btn primary" onClick={() => openCase(null)}>
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

      {tab === "other" ? (
        <OtherRequirementsTab />
      ) : loading ? (
        <div className="empty">Loading…</div>
      ) : error ? (
        <div className="empty error">{error}</div>
      ) : tab === "diagram" ? (
        actorList.length === 0 && caseList.length === 0 ? (
          <div className="empty">
            <b>Nothing to draw yet.</b>{" "}
            {canWrite ? "Start with what the system does, or with who it does it for." : "Nothing here yet."}
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
          canWrite={canWrite}
          onEdit={openCase}
          onDelete={(u) => setDeleting({ kind: "usecase", item: u })}
        />
      )}

      <Drawer
        open={actorDrawer}
        title={editingActor ? "Edit actor" : "New actor"}
        description="Anything outside the system that interacts with it."
        onClose={() => setActorDrawer(false)}
        onSubmit={saveActor}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setActorDrawer(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !actorForm.name.trim()}>
              {saving ? "Saving…" : editingActor ? "Save changes" : "Create actor"}
            </button>
          </>
        }
      >
        <Field label="Kind">
          {/* Each kind is drawn its own way on the diagram, so this is a
              decision about the picture, not a label. */}
          <div className="usecase-kinds" role="radiogroup" aria-label="Kind of actor">
            {ACTOR_KINDS.map((k) => (
              <label key={k.id} className={`usecase-kind${actorForm.kind === k.id ? " is-on" : ""}`} title={k.hint}>
                <input
                  type="radio"
                  name="actor-kind"
                  checked={actorForm.kind === k.id}
                  onChange={() => setActorForm((f) => ({ ...f, kind: k.id as UseCaseActorKind }))}
                />
                <span>{k.label}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Name">
          <input
            className="input"
            required
            placeholder="e.g. Customer, Payment gateway, Nightly run"
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
        <Field label="Who performs it">
          <div className="usecase-checklist">
            {actorList.length === 0 ? (
              <span className="muted">No actors yet — leave this and the system performs it itself.</span>
            ) : (
              actorList.map((a) => (
                <label key={a.id} className="usecase-check">
                  <input type="checkbox" checked={caseForm.actor_ids.includes(a.id)} onChange={() => toggleActor(a.id)} />
                  <span>{a.name}</span>
                  <small className="muted">{ACTOR_KIND_LABEL[a.kind]}</small>
                </label>
              ))
            )}
          </div>
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title={deleting?.kind === "actor" ? "Delete actor" : "Delete use case"}
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
          {deleting?.kind === "actor"
            ? "Use cases it could perform are kept; each becomes one the system performs itself."
            : ""}
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
          header: "Actor",
          className: "primary",
          render: (a) => (
            <NameCell sub={a.description || undefined} onOpen={canWrite ? () => onEdit(a) : undefined}>
              {a.name}
            </NameCell>
          ),
        },
        {
          header: "Kind",
          render: (a) => <span className="badge muted">{ACTOR_KIND_LABEL[a.kind]}</span>,
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
          <b>No actors yet.</b>{" "}
          {canWrite ? "Add whatever interacts with the system — people, other systems, time." : "Nothing here yet."}
        </>
      }
    />
  );
}

function UseCasesTable({
  useCases,
  actorName,
  canWrite,
  onEdit,
  onDelete,
}: {
  useCases: UseCase[];
  actorName: Map<string, string>;
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
          // No actor is a legitimate answer, not a gap: the system does it
          // itself. A warning badge here used to say otherwise.
          render: (u) =>
            u.actor_ids.length === 0 ? (
              <span className="badge muted">The system itself</span>
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
          <b>No use cases yet.</b> {canWrite ? "Add the actions the system offers." : "Nothing here yet."}
        </>
      }
    />
  );
}
