// The requirement pane beside the epic: the requirement read against the
// epic that asked for it, with every field PATCHing as you leave it. There
// is no "dismiss" moment on a pane, so an explicit Save would silently drop
// edits the moment you clicked the next row -- unlike the drawer, which
// batches behind Save. Ported from renderReqPane() in the reference app's
// static/js/reqpane.js.
import { formatDateTime } from "../../../core/format";
import { AssigneeSelect } from "../board/AssigneeSelect";
import { AttachmentsSection } from "../board/AttachmentsSection";
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { IdChip, StatusChip } from "../board/chips";
import { CommentsList } from "../board/CommentsList";
import { ST_ICON, ST_LABEL } from "../board/constants";
import { useDialogs } from "../board/dialogs";
import { EstimateField } from "../board/EstimateField";
import { InlineText } from "../board/InlineText";
import {
  Requirement,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  RequirementPatch,
  RequirementPriority,
  RequirementStatus,
} from "../board/requirementsApi";

interface RequirementPaneProps {
  requirement: Requirement;
  onClose: () => void;
}

export function RequirementPane({ requirement: r, onClose }: RequirementPaneProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const disabled = !canWrite;

  // Failures are toasted by the mutation layer; the pane just stays put.
  const patch = (p: RequirementPatch, opts?: { undo?: boolean }) => mutations.patchRequirement(r.id, p, opts).catch(() => undefined);

  // The requirement's OWN epic (not the effective one): a requirement under
  // an epic inherits that epic's release, so the release control is locked
  // and says where the value comes from.
  const ownEpic = r.epic_id ? index.epicById.get(r.epic_id) ?? null : null;
  const inheritedRelease = ownEpic?.release_id ? index.releaseById.get(ownEpic.release_id) ?? null : null;
  const features = r.epic_id ? index.featuresOf(r.epic_id) : [];
  // A done sprint is never offered, but stays listed while it is this
  // requirement's own -- otherwise the select would silently read "backlog".
  const sprints = index.sprints.filter((s) => !s.closed_at || s.id === r.sprint_id);

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Delete requirement",
      ok: "Delete requirement",
      message: `Delete ${r.human_id} "${r.title}"?`,
    });
    if (!ok) return;
    try {
      await mutations.deleteRequirement(r);
      onClose();
    } catch {
      // Already toasted.
    }
  };

  return (
    <>
      <div className="rqphead">
        <IdChip>{r.human_id}</IdChip>
        <StatusChip status={r.status} />
        {r.queue_position != null && (
          <span className="bchip" title="position in the agent queue">
            queue #{r.queue_position}
          </span>
        )}
        {r.status === "Blocked" && r.blocked_from && (
          <span className="bchip" title="returns here when unblocked">
            was {r.blocked_from}
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="btn mini-x" title="close" onClick={onClose}>
          ✕
        </button>
      </div>

      <InlineText as="div" className="rqp-ttl" value={r.title} disabled={disabled} onSave={(v) => patch({ title: v })} />
      <InlineText
        as="div"
        className="rqp-sum"
        multiline
        value={r.body}
        placeholder="(no description yet)"
        disabled={disabled}
        onSave={(v) => patch({ body: v })}
      />

      <div className="rqp-section">
        <h3>Details</h3>
        <div className="rqp-props">
          <div>
            <label>Status</label>
            <select value={r.status} disabled={disabled} onChange={(e) => void patch({ status: e.target.value as RequirementStatus }, { undo: true })}>
              {REQUIREMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ST_ICON[s]} {ST_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Priority</label>
            <select value={r.priority} disabled={disabled} onChange={(e) => void patch({ priority: e.target.value as RequirementPriority })}>
              {REQUIREMENT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Epic</label>
            {/* A feature belongs to exactly one epic, so changing the epic
                clears the feature in the same PATCH. Moving it off this epic
                closes the pane on the next render -- its row is gone. */}
            <select
              value={r.epic_id ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                void patch(v ? { epic_id: v, clear_feature: true } : { clear_epic: true, clear_feature: true });
              }}
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
            <select
              value={r.feature_id ?? ""}
              disabled={disabled || !r.epic_id}
              onChange={(e) => {
                const v = e.target.value;
                void patch(v ? { feature_id: v } : { clear_feature: true });
              }}
            >
              <option value="">{r.epic_id ? "— none —" : "— no epic —"}</option>
              {features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.human_id} · {f.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Assignee</label>
            <AssigneeSelect
              className=""
              value={r.assignee_id}
              disabled={disabled}
              onChange={(userId) => void patch(userId ? { assignee_id: userId } : { clear_assignee: true })}
            />
          </div>
          <div>
            <label>Release</label>
            <select
              value={r.release_id ?? ""}
              disabled={disabled || !!r.epic_id}
              onChange={(e) => {
                const v = e.target.value;
                void patch(v ? { release_id: v } : { clear_release: true });
              }}
            >
              <option value="">— none —</option>
              {index.releases.map((rel) => (
                <option key={rel.id} value={rel.id}>
                  {rel.human_id} · {rel.title}
                </option>
              ))}
            </select>
            {ownEpic && (
              <span className="rqp-note">
                inherited from {ownEpic.human_id}: {inheritedRelease ? `${inheritedRelease.human_id} · ${inheritedRelease.title}` : "— none —"}
              </span>
            )}
          </div>
          <div>
            <label>Sprint</label>
            <select
              value={r.sprint_id ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                void patch(v ? { sprint_id: v } : { clear_sprint: true });
              }}
            >
              <option value="">— backlog —</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.human_id} · {s.name}
                  {s.closed_at ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Estimate</label>
            <EstimateField value={r.estimate_hours} disabled={disabled} onChange={(h) => void patch({ estimate_hours: h })} />
          </div>
        </div>
      </div>

      <div className="rqp-section">
        <AttachmentsSection entityType="requirement" entityId={r.id} />
      </div>

      <div className="rqp-section">
        <h3>Comments</h3>
        <CommentsList entityType="requirement" entityId={r.id} />
      </div>

      <div className="rqp-section rqp-foot">
        <span className="rqp-meta">
          created {formatDateTime(r.created_at)} · updated {formatDateTime(r.updated_at)}
        </span>
        {canWrite && (
          <button type="button" className="btn mini-x danger-ink" style={{ marginLeft: "auto" }} onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>
    </>
  );
}
