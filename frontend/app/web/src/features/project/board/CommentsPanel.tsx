// The right-hand comments panel for epics, features, releases, sprints and
// docs: a Comments tab (the thread and a composer) and a History tab (every
// recorded event on the entity). Ported from the reference app's #cpanel
// (static/js/comments.js): docked at the right edge, NOT a modal -- there is
// no backdrop, the page moves over to make room and stays fully usable with
// the thread open, and another entity's comment button simply switches the
// panel to that entity. It closes only from its ✕ or on a view change.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router-dom";
import { useLoad } from "../../../core/useLoad";
import { useBoard } from "./boardData";
import type { BoardEntityType } from "./commentsApi";
import { CommentsList } from "./CommentsList";
import { EventRow } from "./EventRow";
import { listEvents } from "./eventsApi";

/**
 * Pass a fresh object per open: identity, not contents, is what re-opens the
 * panel (same entity again resets to the Comments tab with an empty composer).
 */
export interface CommentsTarget {
  type: BoardEntityType;
  id: string;
  label: string;
}

// The reference docks #cpanel at 340px and pulls every view's right edge in
// by the same amount (body.cpanel-open in app.css). Here board.css fixes
// .board-drawer.cpanel to the viewport's right edge and pads the shell's
// main column while body.board-cpanel-open is set, so nothing sits under it.
const BODY_OPEN_CLASS = "board-cpanel-open";

/**
 * Docked, non-modal thread + history for one entity. onClose fires from ✕ and
 * from any pushed navigation (a replace, e.g. ?req=, keeps it open); the
 * parent must drop its target there.
 */
export function CommentsPanel({ target, onClose }: { target: CommentsTarget | null; onClose: () => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const open = target !== null;

  // Every open -- another entity, or the same one again -- starts on the
  // Comments tab with an empty composer, as openComments() does. A page
  // hands over a fresh target object per open, so identity is the count.
  const openSeq = useRef(0);
  const lastTarget = useRef<CommentsTarget | null>(null);
  if (target !== lastTarget.current) {
    lastTarget.current = target;
    openSeq.current += 1;
  }

  useLayoutEffect(() => {
    if (!open) return;
    document.body.classList.add(BODY_OPEN_CLASS);
    return () => document.body.classList.remove(BODY_OPEN_CLASS);
  }, [open]);

  // A view change closes the panel, as the reference's showView() does
  // before it renders the destination: a History-tab link that lands on
  // this very page (the epic itself, a requirement of it, this sprint)
  // pushes a new location without remounting the page, and the thread must
  // not stay up over the result. Picking a row on the page is a replace
  // (the pane's ?req= / ?doc=), not a view change: the panel stays, as
  // #cpanel does beside the reference's detail pane.
  const { key } = useLocation();
  const navType = useNavigationType();
  const keyRef = useRef(key);
  useEffect(() => {
    if (key === keyRef.current) return;
    keyRef.current = key;
    if (navType !== NavigationType.Replace) onCloseRef.current();
  }, [key, navType]);

  if (!target) return null;
  return (
    <div className="board-drawer cpanel" role="complementary" aria-label={target.label}>
      <div className="cphead">
        <b>{target.label}</b>
        <button type="button" className="btn mini-x" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </div>
      <PanelBody key={openSeq.current} target={target} />
    </div>
  );
}

function PanelBody({ target }: { target: CommentsTarget }) {
  const [tab, setTab] = useState<"comments" | "history">("comments");
  return (
    <>
      <div className="cptabs">
        <button type="button" className={`btn mini-x${tab === "comments" ? " on" : ""}`} onClick={() => setTab("comments")}>
          Comments
        </button>
        <button type="button" className={`btn mini-x${tab === "history" ? " on" : ""}`} onClick={() => setTab("history")}>
          History
        </button>
      </div>
      {/* The thread stays mounted behind the History tab, so a half-written
          comment survives a look at the history: the reference only hides
          #cpCompose on a tab change, it never clears it. */}
      <div hidden={tab !== "comments"}>
        <CommentsList entityType={target.type} entityId={target.id} />
      </div>
      {tab === "history" && <History target={target} />}
    </>
  );
}

function History({ target }: { target: CommentsTarget }) {
  const { projectId } = useBoard();
  const events = useLoad(() => listEvents(projectId, { entity_type: target.type, entity_id: target.id, limit: 100 }), [projectId, target.type, target.id]);
  if (events.loading) return <div className="hempty">Loading…</div>;
  if (events.error) return <div className="status-banner warn">{events.error}</div>;
  const rows = events.data ?? [];
  if (!rows.length) return <div className="hempty">No recorded history yet.</div>;
  return (
    <div>
      {rows.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </div>
  );
}
