// Comment thread on any board entity. Reused on the epic detail page for
// both the epic itself and each of its features.
import { useState } from "react";
import { formatDateTime } from "../../../core/format";
import { getTenantUsers } from "../../../core/umApi";
import { useLoad } from "../../../core/useLoad";
import { BoardComment, BoardEntityType, createBoardComment, deleteBoardComment, listBoardComments } from "../plan/boardCommentsApi";

export function CommentsSection({
  projectId,
  orgId,
  entityType,
  entityId,
  canWrite,
}: {
  projectId: string;
  orgId: string;
  entityType: BoardEntityType;
  entityId: string;
  canWrite: boolean;
}) {
  const comments = useLoad(() => listBoardComments(projectId, entityType, entityId), [projectId, entityType, entityId]);
  const members = useLoad(() => getTenantUsers(orgId, "active"), [orgId]);
  const memberById = new Map((members.data ?? []).map((m) => [m.user_id, m]));
  const [newComment, setNewComment] = useState("");

  const post = async () => {
    if (!newComment.trim()) return;
    await createBoardComment(projectId, entityType, entityId, newComment.trim());
    setNewComment("");
    await comments.reload();
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {(comments.data ?? []).length === 0 && <span className="muted">No comments yet.</span>}
      {(comments.data ?? []).map((c: BoardComment) => (
        <div key={c.id} className="section" style={{ padding: 8 }}>
          <div className="muted" style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
            <span>{memberById.get(c.author_id)?.name ?? memberById.get(c.author_id)?.email ?? "Someone"}</span>
            <span>{formatDateTime(c.created_at)}</span>
          </div>
          <p style={{ margin: "4px 0 0" }}>{c.body}</p>
          {canWrite && (
            <button
              type="button"
              className="btn-link"
              style={{ fontSize: 12 }}
              onClick={() => void deleteBoardComment(projectId, c.id).then(() => comments.reload())}
            >
              Delete
            </button>
          )}
        </div>
      ))}
      {canWrite && (
        <div className="list-editor-row">
          <input className="input" placeholder="Add a comment" value={newComment} onChange={(e) => setNewComment(e.target.value)} />
          <button type="button" className="btn small ghost" disabled={!newComment.trim()} onClick={() => void post()}>
            Post
          </button>
        </div>
      )}
    </div>
  );
}
