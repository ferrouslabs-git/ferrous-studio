// A comment thread on one board entity, with a composer. Reads the thread
// from the shared board (loaded once for the whole board), so it is in step
// with the comment counts on cards. Delete is offered only on your own human
// comments, and only to writers: an agent's comment (attributed to whoever
// minted its token) is never deletable from here.
import { useState } from "react";
import { formatDateTime } from "../../../core/format";
import { useBoard } from "./boardData";
import { useBoardMutations } from "./boardMutations";
import type { BoardEntityType } from "./commentsApi";
import { useDialogs } from "./dialogs";

export function CommentsList({ entityType, entityId }: { entityType: BoardEntityType; entityId: string }) {
  const { index, canWrite, currentUserId } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const comments = index.commentsOf(entityId);

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    setPosting(true);
    try {
      await mutations.postComment(entityType, entityId, body);
      setText("");
    } catch {
      // The mutation layer has already shown the server's reason.
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    if (!(await dialogs.confirm({ title: "Delete comment", message: "Delete this comment?", ok: "Delete comment" }))) return;
    await mutations.deleteComment(id).catch(() => undefined);
  };

  return (
    <div className="cmt-list">
      {comments.length === 0 && <div className="hempty">No comments yet.</div>}
      {comments.map((c) => (
        <div key={c.id} className="cmt">
          <div className="cmt-h">
            <b>{c.agent_id ? `${index.agentById.get(c.agent_id)?.name ?? "agent"} (agent)` : index.memberName(c.author_id)}</b>
            <span>{formatDateTime(c.created_at)}</span>
            {canWrite && c.author_id === currentUserId && !c.agent_id && (
              <button type="button" className="cmt-x" title="delete comment" onClick={() => void remove(c.id)}>
                ✕
              </button>
            )}
          </div>
          <div className="cmt-b">{c.body}</div>
        </div>
      ))}
      {canWrite && (
        <>
          <textarea
            className="rqp-cmt"
            placeholder="write a comment…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn mini-x" style={{ marginTop: 8 }} disabled={posting || !text.trim()} onClick={() => void post()}>
            Post
          </button>
        </>
      )}
    </div>
  );
}
