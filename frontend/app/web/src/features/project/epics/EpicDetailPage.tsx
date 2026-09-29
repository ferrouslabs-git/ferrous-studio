// One epic's own page: the epic down the left (fields, attachments, docs,
// requirements grouped by feature) and a detail pane beside it showing
// whichever requirement or doc was clicked last, or a new requirement being
// written. The page is split whether or not anything is open, so opening a
// row never reflows the epic beside it. Ported from the reference app's
// static/js/epicpage.js + reqpane.js + docs.js.
//
// The selection lives in the query string (?req=, ?doc=, ?edit=1, ?new=1
// with an optional &feature=) rather
// than component state, so a feed link or a reload lands on the same thing
// and the pane survives the board refreshing underneath it. The pane shows
// ONE thing at a time: picking a requirement drops the doc and vice versa,
// and picking the open one again closes it. A selection that no longer
// belongs here -- a deleted requirement, a doc moved to another epic -- is
// dropped from the URL rather than rendered out of context.
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useBoard } from "../board/boardData";
import { CommentsPanel, CommentsTarget } from "../board/CommentsPanel";
import type { RequirementPreset } from "../board/RequirementDrawer";
import { DocPane } from "./DocPane";
import { EpicColumn } from "./EpicColumn";
import { NewRequirementPane } from "./NewRequirementPane";
import { RequirementPane } from "./RequirementPane";

interface Selection {
  req?: string | null;
  doc?: string | null;
  edit?: boolean;
  new?: boolean;
  feature?: string | null;
}

const SELECTION_KEYS = ["req", "doc", "edit", "new", "feature"] as const;
/** Opening anything else leaves a half-written new requirement behind. */
const NO_NEW: Selection = { new: false, feature: null };

export function EpicDetailPage() {
  const { epicId = "" } = useParams<{ epicId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, error, index, canWrite } = useBoard();
  const [panel, setPanel] = useState<CommentsTarget | null>(null);

  const reqId = searchParams.get("req");
  const docId = searchParams.get("doc");
  const editing = searchParams.get("edit") === "1";
  // Writing a new requirement needs board:write; a viewer's ?new=1 is dropped below.
  const creating = searchParams.get("new") === "1" && canWrite;
  const presetFeature = searchParams.get("feature");

  const epic = data ? index.epicById.get(epicId) : undefined;
  const requirement = reqId ? index.requirementById.get(reqId) : undefined;
  const doc = docId ? index.docById.get(docId) : undefined;
  const reqShown = !!epic && !!requirement && index.effectiveEpicId(requirement) === epic.id;
  const docShown = !!epic && !!doc && doc.epic_id === epic.id;

  // Every change to the selection is a replace, never a push: clicking down
  // a list of requirements must not leave one history entry per row.
  const select = useCallback(
    (patch: Selection) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of SELECTION_KEYS) {
            if (!(key in patch)) continue;
            const v = patch[key];
            if (v === null || v === undefined || v === false) next.delete(key);
            else next.set(key, v === true ? "1" : v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const selectReq = useCallback(
    (id: string) => select(reqId === id ? { req: null } : { req: id, doc: null, edit: false, ...NO_NEW }),
    [select, reqId],
  );
  const selectDoc = useCallback(
    (id: string) => select(docId === id ? { doc: null, edit: false } : { doc: id, req: null, edit: false, ...NO_NEW }),
    [select, docId],
  );
  const openDocForEditing = useCallback((id: string) => select({ doc: id, req: null, edit: true, ...NO_NEW }), [select]);
  const setEditing = useCallback((on: boolean) => select({ edit: on }), [select]);
  const closePane = useCallback(() => select({ req: null, doc: null, edit: false, ...NO_NEW }), [select]);
  const startNew = useCallback(
    (preset: RequirementPreset) => select({ new: true, feature: preset.featureId ?? null, req: null, doc: null, edit: false }),
    [select],
  );

  // Drop a stale selection once the board is loaded and it is not shown --
  // the row it came from is gone, so the pane must not linger.
  useEffect(() => {
    if (!data || !epic) return;
    const dropReq = !!reqId && !reqShown;
    const dropDoc = !!docId && !docShown;
    const dropEdit = editing && !docShown;
    const dropNew = searchParams.has("new") && !creating;
    if (!dropReq && !dropDoc && !dropEdit && !dropNew) return;
    select({
      ...(dropReq ? { req: null } : {}),
      ...(dropDoc || dropEdit ? { doc: dropDoc ? null : docId, edit: false } : {}),
      ...(dropNew ? NO_NEW : {}),
    });
  }, [data, epic, reqId, docId, editing, reqShown, docShown, creating, searchParams, select]);

  if (error) {
    return (
      <div className="page board-page">
        <div className="status-banner warn">{error}</div>
      </div>
    );
  }
  if (!data) return <div className="page board-page muted">Loading…</div>;

  if (!epic) {
    return (
      <div className="page board-page">
        <div className="epg-layout">
          <div className="epg-body">
            <div className="hempty">Epic not found.</div>
          </div>
        </div>
      </div>
    );
  }

  // A new requirement takes the pane ahead of everything (starting one clears
  // the rest); then a doc ahead of a requirement, as the reference does --
  // both being set at once only happens to a hand-edited URL. The
  // requirement pane is keyed so switching rows remounts it, as the
  // reference's renderReqPane() rebuilds the whole pane -- a half-typed
  // comment for one requirement must not carry over to the next.
  const pane = creating ? (
    <NewRequirementPane epic={epic} featureId={presetFeature} onCancel={closePane} onCreated={(r) => select({ req: r.id, ...NO_NEW })} />
  ) : docShown ? (
    <DocPane doc={doc} editing={editing} onEditing={setEditing} onClose={closePane} onOpenComments={setPanel} />
  ) : reqShown ? (
    <RequirementPane key={requirement.id} requirement={requirement} onClose={closePane} />
  ) : (
    <div className="rqp-idle">
      <span className="muted">No requirement or doc open.</span>
      {canWrite && (
        <button type="button" className="btn" onClick={() => startNew({ epicId: epic.id })}>
          + New requirement
        </button>
      )}
    </div>
  );

  return (
    <div className="page board-page">
      <div className="epg-layout">
        <div className="epg-body">
          <EpicColumn
            epic={epic}
            selectedReq={reqShown ? reqId : null}
            selectedDoc={docShown ? docId : null}
            onSelectReq={selectReq}
            onSelectDoc={selectDoc}
            onDocCreated={openDocForEditing}
            onNewRequirement={startNew}
            onOpenComments={setPanel}
          />
        </div>
        <aside className="rqp-pane">{pane}</aside>
      </div>
      <CommentsPanel target={panel} onClose={() => setPanel(null)} />
    </div>
  );
}
