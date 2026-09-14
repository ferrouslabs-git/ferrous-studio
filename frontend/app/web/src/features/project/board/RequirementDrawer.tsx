// The requirement drawer: opened from a sprint-board card, a backlog or
// sprint row, or "+ Requirement" on the epic page. Every field, saved
// together with Save (unlike the epic page's pane, which patches as you
// go); comments and attachments once the requirement exists. A blank title
// saves as "Untitled". Ported from the reference app's #drawer
// (static/js/requirements.js).
import { FormEvent, useEffect, useRef, useState } from "react";
import { Drawer, Field } from "../../../components/Drawer";
import { formatDateTime } from "../../../core/format";
import { AttachmentsSection } from "./AttachmentsSection";
import { useBoard } from "./boardData";
import { useBoardMutations } from "./boardMutations";
import { CommentsList } from "./CommentsList";
import { ST_ICON } from "./constants";
import { useDialogs } from "./dialogs";
import { EstimateField } from "./EstimateField";
import {
  Requirement,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  RequirementInput,
  RequirementPriority,
  RequirementStatus,
} from "./requirementsApi";

export interface RequirementPreset {
  epicId?: string | null;
  featureId?: string | null;
}

interface RequirementDrawerProps {
  open: boolean;
  /** The requirement to edit, or null for a new one. */
  requirement: Requirement | null;
  preset?: RequirementPreset;
  /** Escape, Cancel and the backdrop all land here with unsaved edits dropped; a dialog or lightbox raised over the drawer takes Escape first. */
  onClose: () => void;
  /** Called with the saved row after Save; onClose follows immediately after, so close-side work runs on every exit. */
  onSaved?: (requirement: Requirement) => void;
}

export function RequirementDrawer({ open, requirement, preset, onClose, onSaved }: RequirementDrawerProps) {
  const dialogs = useDialogs();
  if (!open) return null;
  return (
    <DrawerBody
      key={requirement?.id ?? "new"}
      requirement={requirement}
      preset={preset}
      onClose={onClose}
      onSaved={onSaved}
      closeOnEscape={!dialogs.isOpen}
    />
  );
}

interface FormState {
  title: string;
  body: string;
  epic_id: string | null;
  feature_id: string | null;
  status: RequirementStatus;
  priority: RequirementPriority;
  assignee_id: string | null;
  release_id: string | null;
  sprint_id: string | null;
  estimate_hours: number | null;
}

function DrawerBody({
  requirement,
  preset = {},
  onClose,
  onSaved,
  closeOnEscape,
}: Omit<RequirementDrawerProps, "open"> & { closeOnEscape: boolean }) {
  const { index, members, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  // The Feature select lists the DIRECT epic's features only, so a feature
  // held with no epic of its own (an agent's doing) matches no option and
  // the select reads none -- and what the drawer shows is what Save stores,
  // as the reference's fillDrawerFeatureSelect() leaves such a select on ""
  // and #dSave sends its value. Start the form from the option that can be
  // shown, never from a link the form cannot display.
  const shownFeature = (epicId: string | null, featureId: string | null) =>
    epicId && featureId && index.featuresOf(epicId).some((f) => f.id === featureId) ? featureId : null;
  const [form, setForm] = useState<FormState>(() =>
    requirement
      ? {
          title: requirement.title,
          body: requirement.body,
          epic_id: requirement.epic_id,
          feature_id: shownFeature(requirement.epic_id, requirement.feature_id),
          status: requirement.status,
          priority: requirement.priority,
          assignee_id: requirement.assignee_id,
          release_id: requirement.release_id,
          sprint_id: requirement.sprint_id,
          estimate_hours: requirement.estimate_hours,
        }
      : {
          title: "",
          body: "",
          epic_id: preset.epicId ?? null,
          feature_id: shownFeature(preset.epicId ?? null, preset.featureId ?? null),
          status: "Todo",
          priority: "Medium",
          assignee_id: null,
          release_id: null,
          sprint_id: null,
          estimate_hours: null,
        },
  );
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  // Escape closes the drawer whichever field holds focus -- a capture-phase
  // listener, as the reference's (static/js/requirements.js), so it runs
  // ahead of every field's own keydown handler and of the Drawer's
  // bubble-phase listener, which is switched off below with
  // closeOnEscape={false} so the two never disagree.
  // Only an open dialog or lightbox pre-empts it: closeOnEscape is false
  // while one is up, and the key is left to it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeOnEscapeRef = useRef(closeOnEscape);
  closeOnEscapeRef.current = closeOnEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !closeOnEscapeRef.current) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const epic = form.epic_id ? index.epicById.get(form.epic_id) : null;
  const features = form.epic_id ? index.featuresOf(form.epic_id) : [];
  // A done sprint is never offered, but stays listed while it is this
  // requirement's own -- otherwise the select would silently read "backlog".
  const sprints = index.sprints.filter((s) => s.state !== "done" || s.id === form.sprint_id);
  const inheritedRelease = epic ? (epic.release_id ? index.releaseById.get(epic.release_id) : null) : undefined;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const input: RequirementInput = {
        // The reference's server stores a blank title as "Untitled"
        // (backend/main.py); ours refuses one, so the same default is applied
        // here -- Save is never withheld for want of a title.
        title: form.title.trim() || "Untitled",
        body: form.body,
        epic_id: form.epic_id,
        feature_id: form.feature_id,
        status: form.status,
        priority: form.priority,
        assignee_id: form.assignee_id,
        release_id: form.release_id,
        sprint_id: form.sprint_id,
        estimate_hours: form.estimate_hours,
      };
      const saved = requirement
        ? await mutations.patchRequirement(
            requirement.id,
            {
              ...input,
              clear_epic: input.epic_id === null,
              clear_feature: input.feature_id === null,
              clear_assignee: input.assignee_id === null,
              clear_release: input.release_id === null,
              clear_sprint: input.sprint_id === null,
            },
            { saved: true },
          )
        : await mutations.createRequirement(input);
      onSaved?.(saved);
      onClose();
    } catch {
      // Already toasted by the mutation layer.
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!requirement) return;
    const ok = await dialogs.confirm({
      title: "Delete requirement",
      message: `Delete ${requirement.human_id} "${requirement.title}"?`,
      ok: "Delete requirement",
    });
    if (!ok) return;
    try {
      await mutations.deleteRequirement(requirement);
      onClose();
    } catch {
      // Already toasted.
    }
  };

  return (
    <Drawer
      open
      title={requirement ? requirement.human_id : "New requirement"}
      onClose={onClose}
      onSubmit={canWrite ? save : undefined}
      width={560}
      className="board-drawer"
      // Escape is handled above, in the capture phase; the Drawer's own
      // bubble-phase listener would never see the key from a field that
      // stops propagation, so it is switched off rather than left to
      // disagree.
      closeOnEscape={false}
      footer={
        canWrite ? (
          <>
            {requirement && (
              <button type="button" className="btn ghost danger" onClick={() => void remove()} style={{ marginRight: "auto" }}>
                Delete
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      <Field label="Title">
        <input className="input" value={form.title} disabled={!canWrite} onChange={(e) => patch({ title: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="input textarea" rows={4} value={form.body} disabled={!canWrite} onChange={(e) => patch({ body: e.target.value })} />
      </Field>
      <div className="rqp-props" style={{ marginTop: 0 }}>
        <div>
          <label>Epic</label>
          <select
            className="select"
            value={form.epic_id ?? ""}
            disabled={!canWrite}
            onChange={(e) => patch({ epic_id: e.target.value || null, feature_id: null })}
          >
            <option value="">— none —</option>
            {index.epics.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.human_id} · {ep.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Feature</label>
          <select className="select" value={form.feature_id ?? ""} disabled={!canWrite || !form.epic_id} onChange={(e) => patch({ feature_id: e.target.value || null })}>
            <option value="">{form.epic_id ? "— none —" : "— no epic —"}</option>
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.human_id} · {f.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select className="select" value={form.status} disabled={!canWrite} onChange={(e) => patch({ status: e.target.value as RequirementStatus })}>
            {REQUIREMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ST_ICON[s]} {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Priority</label>
          <select className="select" value={form.priority} disabled={!canWrite} onChange={(e) => patch({ priority: e.target.value as RequirementPriority })}>
            {REQUIREMENT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Assignee</label>
          <select className="select" value={form.assignee_id ?? ""} disabled={!canWrite} onChange={(e) => patch({ assignee_id: e.target.value || null })}>
            <option value="">— unassigned —</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Release</label>
          <select className="select" value={form.release_id ?? ""} disabled={!canWrite || !!epic} onChange={(e) => patch({ release_id: e.target.value || null })}>
            <option value="">— none —</option>
            {index.releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.human_id} · {r.title}
              </option>
            ))}
          </select>
          {epic && (
            <span className="rqp-note">
              inherited from {epic.human_id}: {inheritedRelease ? `${inheritedRelease.human_id} · ${inheritedRelease.title}` : "— none —"}
            </span>
          )}
        </div>
        <div>
          <label>Sprint</label>
          <select className="select" value={form.sprint_id ?? ""} disabled={!canWrite} onChange={(e) => patch({ sprint_id: e.target.value || null })}>
            <option value="">— backlog —</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.human_id} · {s.name}
                {s.state === "active" ? " (active)" : ""}
                {s.release_id ? ` · ${index.releaseById.get(s.release_id)?.human_id ?? ""}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Estimate</label>
          <EstimateField value={form.estimate_hours} disabled={!canWrite} onChange={(h) => patch({ estimate_hours: h })} />
        </div>
      </div>
      {requirement && (
        <>
          <div className="rqp-meta">
            created {formatDateTime(requirement.created_at)} · updated {formatDateTime(requirement.updated_at)}
          </div>
          <div className="rqp-section">
            <h3>Comments</h3>
            <CommentsList entityType="requirement" entityId={requirement.id} />
          </div>
          <div className="rqp-section">
            <AttachmentsSection entityType="requirement" entityId={requirement.id} />
          </div>
        </>
      )}
    </Drawer>
  );
}
