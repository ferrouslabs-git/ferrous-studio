// A comment thread on one board entity, with a composer. Reads the thread
// from the shared board (loaded once for the whole board), so it is in step
// with the comment counts on cards. Delete is offered only on your own human
// comments, and only to writers: an agent's comment (attributed to whoever
// minted its token) is never deletable from here.
//
// A comment can carry files -- a screenshot of what is wrong, the marked-up
// document -- attached from the button, dropped on the composer or pasted
// into it. They upload once the comment is posted (an upload is minted
// against the comment's id), and a comment may be files alone. Only a
// comment's author removes one of its files, as only they delete it.
import { ClipboardEvent, useState } from "react";
import { formatBytes, formatDateTime } from "../../../core/format";
import type { BoardAttachment } from "../attachmentsApi";
import { AttachButton, AttachmentThumb, useFileDrop } from "./AttachmentsSection";
import { useAttachmentPreview } from "./AttachmentPreview";
import { useBoard } from "./boardData";
import { useBoardMutations } from "./boardMutations";
import type { BoardComment, BoardEntityType } from "./commentsApi";
import { useDialogs } from "./dialogs";
import { previewKindFor } from "./previewKinds";

export function CommentsList({ entityType, entityId }: { entityType: BoardEntityType; entityId: string }) {
  const { projectId, index, canWrite, currentUserId } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const preview = useAttachmentPreview();
  const comments = index.commentsOf(entityId);
  const addFiles = (more: File[]) => setFiles((f) => [...f, ...more]);
  const drop = useFileDrop(addFiles, !canWrite || posting);

  const post = async () => {
    const body = text.trim();
    if (!body && !files.length) return;
    setPosting(true);
    try {
      await mutations.postComment(entityType, entityId, body, files);
      setText("");
      setFiles([]);
    } catch {
      // The mutation layer has already shown the server's reason.
    } finally {
      setPosting(false);
    }
  };

  // A screenshot on the clipboard becomes an attachment; text pastes as text.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) return;
    e.preventDefault();
    // Clipboard images all arrive as "image.png"; name them so a thread of them can be told apart.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    addFiles(pasted.map((f, i) => (f.name === "image.png" ? new File([f], `pasted-${stamp}${pasted.length > 1 ? `-${i + 1}` : ""}.png`, { type: f.type }) : f)));
  };

  const remove = async (id: string) => {
    if (!(await dialogs.confirm({ title: "Delete comment", message: "Delete this comment?", ok: "Delete comment" }))) return;
    await mutations.deleteComment(id).catch(() => undefined);
  };

  const removeFile = async (c: BoardComment, a: BoardAttachment) => {
    if (!(await dialogs.confirm({ title: "Remove file", message: `Remove "${a.filename}" from this comment?`, ok: "Remove" }))) return;
    await mutations.removeCommentAttachment(c, a.id).catch(() => undefined);
  };

  return (
    <div className="cmt-list">
      {comments.length === 0 && <div className="hempty">No comments yet.</div>}
      {comments.map((c) => {
        const mine = canWrite && c.author_id === currentUserId && !c.agent_id;
        const atts = c.attachments ?? [];
        return (
          <div key={c.id} className="cmt">
            <div className="cmt-h">
              <b>{c.agent_id ? `${index.agentById.get(c.agent_id)?.name ?? "agent"} (agent)` : index.memberName(c.author_id)}</b>
              <span>{formatDateTime(c.created_at)}</span>
              {mine && (
                <button type="button" className="cmt-x" title="delete comment" onClick={() => void remove(c.id)}>
                  ✕
                </button>
              )}
            </div>
            {c.body && <div className="cmt-b">{c.body}</div>}
            {atts.length > 0 && (
              <div className="cmt-files">
                {atts.map((a, i) => (
                  <span key={a.id} className="cmt-file">
                    <button type="button" className={previewKindFor(a) === "image" ? "att-thumb" : "cmt-file-name"} title={a.filename} onClick={() => preview.open(atts, i)}>
                      {previewKindFor(a) === "image" ? <AttachmentThumb projectId={projectId} attachment={a} /> : a.filename}
                    </button>
                    {mine && (
                      <button type="button" className="cmt-file-x" title="remove file" aria-label={`Remove ${a.filename}`} onClick={() => void removeFile(c, a)}>
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {canWrite && (
        <div className={`cmt-compose${drop.over ? " att-drop" : ""}`} {...drop.handlers}>
          <textarea
            className="rqp-cmt"
            placeholder="write a comment…"
            value={text}
            disabled={posting}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
          />
          {files.length > 0 && (
            <div className="cmt-pending">
              {files.map((f, i) => (
                <span key={`${f.name}-${f.size}-${f.lastModified}-${i}`} className="bchip cmt-pending-file" title={`${f.name} · ${formatBytes(f.size)}`}>
                  {f.name}
                  {!posting && (
                    <button type="button" className="cmt-file-x" aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="cmt-actions">
            <button type="button" className="btn mini-x" disabled={posting || (!text.trim() && !files.length)} onClick={() => void post()}>
              {posting ? (files.length ? "Posting and uploading…" : "Posting…") : "Post"}
            </button>
            <AttachButton busy={posting} label="+ Attach files" onFiles={addFiles} />
          </div>
          {drop.over && <div className="att-drop-note">Drop to attach</div>}
        </div>
      )}
      {preview.element}
    </div>
  );
}
