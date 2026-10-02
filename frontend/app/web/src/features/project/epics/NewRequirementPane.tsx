// A new requirement, written in the pane beside the epic -- the same place
// and the same shape as editing one (RequirementPane), rather than a drawer
// over the page. Unlike the edit pane nothing is saved field by field: there
// is no row to PATCH until Create, so the form is held here and posted once.
// Files attached before Create are held too, and uploaded to the new
// requirement straight after it exists; the pane then becomes that
// requirement's edit pane. A blank title saves as "Untitled", as the drawer's
// does.
import { FormEvent, useEffect, useRef, useState } from "react";
import { AssigneeSelect } from "../board/AssigneeSelect";
import { uploadAll } from "../attachmentsApi";
import { PendingAttachments, pasteFiles } from "../board/AttachmentsSection";
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { ST_ICON, ST_LABEL } from "../board/constants";
import { EstimateField } from "../board/EstimateField";
import type { Epic } from "../board/epicsApi";
import { Requirement, REQUIREMENT_PRIORITIES, REQUIREMENT_STATUSES, RequirementPriority, RequirementStatus } from "../board/requirementsApi";
import { useToast } from "../board/toast";

interface NewRequirementPaneProps {
  epic: Epic;
  /** The feature it was started from, if any. */
  featureId: string | null;
  onCreated: (requirement: Requirement) => void;
  onCancel: () => void;
}

export function NewRequirementPane({ epic, featureId, onCreated, onCancel }: NewRequirementPaneProps) {
  const { projectId, index } = useBoard();
  const mutations = useBoardMutations();
  const toast = useToast();
  const features = index.featuresOf(epic.id);
  const sprints = index.sprints.filter((s) => !s.closed_at);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [feature, setFeature] = useState<string | null>(features.some((f) => f.id === featureId) ? featureId : null);
  const [status, setStatus] = useState<RequirementStatus>("NotStarted");
  const [priority, setPriority] = useState<RequirementPriority>("Medium");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [sprint, setSprint] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  // Starting from another feature's "+" re-points the open form rather than
  // opening a second one.
  useEffect(() => {
    setFeature(features.some((f) => f.id === featureId) ? featureId : null);
  }, [featureId]);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving("Creating…");
    try {
      const saved = await mutations.createRequirement({
        title: title.trim() || "Untitled",
        body,
        epic_id: epic.id,
        feature_id: feature,
        status,
        priority,
        assignee_id: assignee,
        release_id: null,
        sprint_id: sprint,
        estimate_hours: estimate,
      });
      if (files.length) {
        setSaving(`Uploading 1 of ${files.length}…`);
        // The requirement exists now whatever happens to its files; a failed
        // one is toasted and can be attached again from its pane.
        await uploadAll(projectId, "requirement", saved.id, files, toast, (done) =>
          setSaving(`Uploading ${Math.min(done + 1, files.length)} of ${files.length}…`),
        );
      }
      onCreated(saved);
    } catch {
      // Already toasted by the mutation layer.
      setSaving(null);
    }
  };

  const busy = saving !== null;

  return (
    // Paste is caught on the form so a screenshot lands as an attachment from the title or description alike.
    <form
      className="rqp-new"
      onSubmit={create}
      onPaste={pasteFiles((more) => setFiles((all) => [...all, ...more]), busy)}
      onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}>
      <div className="rqphead">
        <span className="bchip k">New requirement</span>
        <span className="bchip" title={epic.title}>
          {epic.human_id}
        </span>
        <span className="spacer" />
        <button type="button" className="btn mini-x" title="close" disabled={busy} onClick={onCancel}>
          ✕
        </button>
      </div>

      <input
        ref={titleRef}
        className="input rqp-ttl-in"
        placeholder="Title"
        aria-label="Title"
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="input textarea rqp-sum-in"
        rows={4}
        placeholder="Description"
        aria-label="Description"
        value={body}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
      />

      <div className="rqp-section">
        <h3>Details</h3>
        <div className="rqp-props">
          <div>
            <label>Status</label>
            <select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as RequirementStatus)}>
              {REQUIREMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ST_ICON[s]} {ST_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Priority</label>
            <select value={priority} disabled={busy} onChange={(e) => setPriority(e.target.value as RequirementPriority)}>
              {REQUIREMENT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Feature</label>
            <select value={feature ?? ""} disabled={busy} onChange={(e) => setFeature(e.target.value || null)}>
              <option value="">— none —</option>
              {features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.human_id} · {f.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Assignee</label>
            <AssigneeSelect className="" value={assignee} disabled={busy} onChange={setAssignee} />
          </div>
          <div>
            <label>Sprint</label>
            <select value={sprint ?? ""} disabled={busy} onChange={(e) => setSprint(e.target.value || null)}>
              <option value="">— backlog —</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.human_id} · {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Estimate</label>
            <EstimateField value={estimate} disabled={busy} onChange={setEstimate} />
          </div>
        </div>
      </div>

      <div className="rqp-section">
        <PendingAttachments files={files} onChange={setFiles} disabled={busy} />
      </div>

      <div className="rqp-section rqp-foot">
        <span className="spacer" />
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          {saving ?? "Create requirement"}
        </button>
      </div>
    </form>
  );
}
