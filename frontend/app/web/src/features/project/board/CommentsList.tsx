// A comment thread on one board entity, with a composer. Reads the thread
// from the shared board (loaded once for the whole board), so it is in step
// with the comment counts on cards. Edit and delete are offered only on your
// own human comments, and only to writers: an agent's comment (attributed to
// whoever minted its token) is never editable or deletable from here.
//
// A comment can carry files -- a screenshot of what is wrong, the marked-up
// document -- attached from the button, dropped on the composer or pasted
// into it. They upload once the comment is posted (an upload is minted
// against the comment's id), and a comment may be files alone. Only a
// comment's author removes one of its files, as only they delete it.
import { useState } from "react";
import { formatBytes, formatDateTime } from "../../../core/format";
import type { BoardAttachment } from "../attachmentsApi";
import { AttachButton, AttachmentThumb, pasteFiles, useFileDrop } from "./AttachmentsSection";
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
  const onPaste = pasteFiles(addFiles);

  // One comment at a time is open for editing, in place of its text.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const saveEdit = async (c: BoardComment) => {
    if (!editing) return;
    const body = editing.text.trim();
    if (body === c.body) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      await mutations.editComment(c.id, body);
      setEditing(null);
    } catch {
      // The mutation layer has already shown the server's reason.
    } finally {
      setSaving(false);
    }
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
              {c.edited_at && <span title={`Edited ${formatDateTime(c.edited_at)}`}>(edited)</span>}
              {mine && editing?.id !== c.id && (
                <span className="cmt-tools">
                  <button type="button" className="cmt-edit" title="edit comment" onClick={() => setEditing({ id: c.id, text: c.body })}>
                    Edit
                  </button>
                  <button type="button" className="cmt-x" title="delete comment" onClick={() => void remove(c.id)}>
                    ✕
                  </button>
                </span>
              )}
            </div>
            {editing?.id === c.id ? (
              <div className="cmt-editing">
                <textarea
                  className="rqp-cmt"
                  autoFocus
                  value={editing.text}
                  disabled={saving}
                  onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(null);
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void saveEdit(c);
                  }}
                />
                <div className="cmt-actions">
                  <button
                    type="button"
                    className="btn mini-x"
                    disabled={saving || (!editing.text.trim() && !atts.length)}
                    onClick={() => void saveEdit(c)}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="btn mini-x" disabled={saving} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              c.body && <div className="cmt-b">{c.body}</div>
            )}
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
