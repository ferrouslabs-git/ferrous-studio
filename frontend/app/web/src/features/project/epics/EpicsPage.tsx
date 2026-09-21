// The Epics tab: every epic, one card each, in id order. The card head is the
// epic itself and ▾ folds open its features; which release an epic is in is
// decided on the Roadmap and only shown here. Cards start folded -- the page
// is a list first, and the features are one click away when you want them.
// Ported from the reference app's renderEpicsPage (static/js/roadmap.js).
//
// The release filter takes several releases at once, and "Not in a release"
// is one of the things it can be set to: this page is where the epics in no
// release are found, since the Roadmap stopped listing them (2026-09-18).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { CommentsPanel, CommentsTarget } from "../board/CommentsPanel";
import { useDialogs } from "../board/dialogs";
import { Epic } from "../board/epicsApi";
import type { Feature } from "../board/featuresApi";
import { boardStorageKey, useFoldMap } from "../board/folds";
import { MultiSelect } from "../board/MultiSelect";
import { EpicCard } from "./EpicCard";

/** The release filter's entry for "not in a release" -- no release has this id. */
const NO_RELEASE = "__none__";

// Stable identity: useFoldMap memoises on it.
const foldedByDefault = () => true;

// An epic matches the search by its id, title and summary, and by the ids and
// titles of its features.
function epicMatches(epic: Epic, features: Feature[], q: string): boolean {
  if (!q) return true;
  const hay = [epic.human_id, epic.title, epic.summary ?? "", ...features.map((f) => `${f.human_id} ${f.title}`)]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

// The reference's search box (#epq) is a static input that nothing ever
// clears: opening an epic only hides the list pane, so coming back finds the
// typed text still there and the filter still applied. Here the list unmounts
// on that round trip (the epic page is its own route), so the text is
// remembered per project for the life of the page -- in memory only, like the
// input itself: a reload starts blank, exactly as the reference does.
const rememberedQuery = new Map<string, string>();

function useRememberedQuery(projectId: string): [string, (q: string) => void] {
  const [query, setQueryState] = useState(() => rememberedQuery.get(projectId) ?? "");
  const projectRef = useRef(projectId);
  useEffect(() => {
    if (projectRef.current === projectId) return;
    projectRef.current = projectId;
    setQueryState(rememberedQuery.get(projectId) ?? "");
  }, [projectId]);
  const setQuery = useCallback(
    (q: string) => {
      rememberedQuery.set(projectId, q);
      setQueryState(q);
    },
    [projectId],
  );
  return [query, setQuery];
}

export function EpicsPage() {
  const { projectId, data, error, index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const [query, setQuery] = useRememberedQuery(projectId);
  const [releaseFilter, setReleaseFilter] = useState<Set<string>>(() => new Set());
  const [comments, setComments] = useState<CommentsTarget | null>(null);
  const fold = useFoldMap(boardStorageKey(projectId, "epicFold"), foldedByDefault);

  // An epic filed under a release that has since been deleted is treated as
  // unfiled, the same way the roadmap and EpicCard already treat it.
  const releaseOptions = useMemo(
    () => [
      ...index.releases.map((r) => ({ value: r.id, label: `${r.human_id} · ${r.title}` })),
      { value: NO_RELEASE, label: "Not in a release" },
    ],
    [index.releases],
  );
  const inReleaseFilter = useCallback(
    (e: Epic) => {
      if (releaseFilter.size === 0) return true;
      const filed = e.release_id && index.releaseById.has(e.release_id) ? e.release_id : NO_RELEASE;
      return releaseFilter.has(filed);
    },
    [releaseFilter, index],
  );

  const newEpic = async () => {
    const v = await dialogs.form({
      title: "New epic",
      ok: "Create",
      fields: [
        { key: "title", label: "Title", required: true, placeholder: "e.g. Bulk import" },
        { key: "summary", label: "Summary", type: "textarea", placeholder: "what should this look like when it's done?" },
        {
          key: "release",
          label: "Release",
          type: "select",
          placeholder: "— unassigned —",
          options: index.releases.map((m) => ({ value: m.id, label: `${m.human_id} · ${m.title}` })),
        },
      ],
    });
    if (!v) return;
    try {
      await mutations.createEpic({ title: v.title, summary: v.summary, release_id: v.release || null });
    } catch {
      // Toasted by the mutation.
    }
  };

  if (!data) {
    return (
      <div className="page board-page muted">{error ? <div className="status-banner warn">{error}</div> : "Loading…"}</div>
    );
  }

  const all = index.epics;
  const q = query.trim().toLowerCase();
  const shown = all.filter((e) => inReleaseFilter(e) && epicMatches(e, index.featuresOf(e.id), q));
  const narrowed = shown.length !== all.length;

  return (
    <div className="page board-page">
      {error && <div className="status-banner warn">{error}</div>}
      <div className="viewbar">
        {canWrite && (
          <button type="button" className="btn" onClick={() => void newEpic()}>
            + New epic
          </button>
        )}
        <input className="q2" placeholder="search epics…" aria-label="search epics" value={query} onChange={(e) => setQuery(e.target.value)} />
        <MultiSelect
          allLabel="All releases"
          countLabel="releases"
          ariaLabel="filter epics by release"
          options={releaseOptions}
          selected={releaseFilter}
          onChange={setReleaseFilter}
        />
        <span className="tk-right">
          <span className="viewbar-count">
            {narrowed ? `${shown.length} of ${all.length} epics` : `${all.length} epic${all.length === 1 ? "" : "s"}`}
          </span>
        </span>
      </div>

      {all.length === 0 ? (
        <div className="hempty centred">
          <div>
            An epic is a chunk of the product worth planning as one: its features, its requirements, its docs. Make one, then put it in a
            release on the Roadmap.
          </div>
          {canWrite && (
            <button type="button" className="btn primary" onClick={() => void newEpic()}>
              ＋ Create your first epic
            </button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="hempty">{q ? `No epic matches “${q}”.` : "No epic is filed under the releases you picked."}</div>
      ) : (
        shown.map((e) => (
          <EpicCard key={e.id} epic={e} folded={fold.isFolded(e.id)} onToggleFold={() => fold.toggle(e.id)} onComments={setComments} />
        ))
      )}

      <CommentsPanel target={comments} onClose={() => setComments(null)} />
    </div>
  );
}
