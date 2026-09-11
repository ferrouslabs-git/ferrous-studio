// The doc pane beside the epic: a markdown doc read in place, or -- with
// ?edit=1 -- a plain textarea over the raw markdown that "✓ Done" saves in
// one PATCH. The title and the epic it is filed under patch as you go, as
// the requirement pane's fields do. Ported from renderDocPane() in the
// reference app's static/js/docs.js.
import { useRef } from "react";
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { IdChip } from "../board/chips";
import type { CommentsTarget } from "../board/CommentsPanel";
import { useDialogs } from "../board/dialogs";
import type { BoardDoc } from "../board/docsApi";
import { Icon } from "../board/icons";
import { InlineText } from "../board/InlineText";
import { useToast } from "../board/toast";
import { MarkdownWithMermaid } from "./MarkdownWithMermaid";

interface DocPaneProps {
  doc: BoardDoc;
  editing: boolean;
  onEditing: (on: boolean) => void;
  onClose: () => void;
  onOpenComments: (target: CommentsTarget) => void;
}

export function DocPane({ doc: d, editing, onEditing, onClose, onOpenComments }: DocPaneProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const toast = useToast();
  const editor = useRef<HTMLTextAreaElement>(null);
  const isEditing = editing && canWrite;

  // ✓ Done saves the body only when it changed, then leaves edit mode. A
  // failed save (already toasted) keeps the editor up so nothing is lost.
  const toggleMode = async () => {
    if (!isEditing) {
      onEditing(true);
      return;
    }
    const body = editor.current?.value ?? d.body;
    if (body !== d.body) {
      try {
        await mutations.patchDoc(d.id, { body });
      } catch {
        return;
      }
    }
    onEditing(false);
  };

  // Once moved the doc no longer belongs to the epic on screen, so the pane
  // closes -- and the toast says where it went.
  const move = async (epicId: string) => {
    if (!epicId || epicId === d.epic_id) return;
    try {
      const it = await mutations.patchDoc(d.id, { epic_id: epicId });
      const target = index.epicById.get(it.epic_id ?? epicId);
      toast(`${d.human_id} moved to ${target?.human_id ?? "another epic"}`);
      onClose();
    } catch {
      // Already toasted.
    }
  };

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Delete doc",
      ok: "Delete doc",
      message: `Delete doc ${d.human_id} "${d.title}" and its comments?`,
    });
    if (!ok) return;
    try {
      await mutations.deleteDoc(d);
      onClose();
    } catch {
      // Already toasted.
    }
  };

  return (
    <>
      <div className="rqphead">
        <IdChip>{d.human_id}</IdChip>
        <span className="bchip">doc</span>
        <span style={{ marginLeft: "auto" }} />
        {canWrite && (
          <button type="button" className="btn mini-x" onClick={() => void toggleMode()}>
            {isEditing ? "✓ Done" : "✎ Edit"}
          </button>
        )}
        {/* A plain button, not CommentButton: the reference's renderDocPane()
            deliberately skips cmtBtnHtml()'s hover-only cmt-zero styling, so
            the doc's comments (and its History tab) stay reachable when it
            has no comments yet -- the pane has no inline thread of its own. */}
        <button type="button" className="btn mini-x" title="comments" onClick={() => onOpenComments({ type: "doc", id: d.id, label: `${d.human_id} · ${d.title}` })}>
          <Icon name="message" small />
          {index.commentCount(d.id) || ""}
        </button>
        <button type="button" className="btn mini-x" title="close" onClick={onClose}>
          ✕
        </button>
      </div>

      <InlineText as="div" className="rqp-ttl" value={d.title} disabled={!canWrite} onSave={(v) => mutations.patchDoc(d.id, { title: v }).catch(() => undefined)} />

      <div className="doc-meta">
        <span>
          by {index.memberName(d.created_by)} · created {d.created_at.slice(0, 10)} · updated {d.updated_at.slice(0, 16).replace("T", " ")}
        </span>
        <label className="doc-move">
          in{" "}
          <select value={d.epic_id ?? ""} disabled={!canWrite} onChange={(e) => void move(e.target.value)}>
            {index.epics.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.human_id} · {ep.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isEditing ? (
        <textarea
          key={d.id}
          ref={editor}
          className="doc-editor"
          defaultValue={d.body}
          placeholder="Write markdown…"
          autoFocus
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        <MarkdownWithMermaid body={d.body} />
      )}

      <div className="rqp-section rqp-foot">
        {canWrite && (
          <button type="button" className="btn mini-x danger-ink" style={{ marginLeft: "auto" }} onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>
    </>
  );
}
