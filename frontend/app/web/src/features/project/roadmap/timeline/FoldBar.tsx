// A card's fold bar: "▾ 2 sprints · AG1" / "▸ 3 epics". Per card, per kind,
// persisted -- a folded list is a decision about what you want to see. When
// the sprints are folded, the agents delivering them still show on the
// button, so a running agent never disappears from the roadmap. Ported from
// the reference app's tlFoldBar (static/js/timeline.js).
import type { ReactNode } from "react";
import { useBoard } from "../../board/boardData";
import type { Epic } from "../../board/epicsApi";
import type { Sprint } from "../../board/sprintsApi";
import { CrewChip } from "./CrewChip";

export type FoldKind = "sprints" | "epics";

/** The stored shape: release id (or "" for the Unassigned card) -> what is folded. */
export type FoldMap = Record<string, { sprints?: boolean; epics?: boolean }>;

export interface TimelineFolds {
  folded: (releaseId: string | null, kind: FoldKind) => boolean;
  setFold: (releaseId: string | null, kind: FoldKind, folded: boolean) => void;
}

interface FoldBarProps {
  /** The release, or null for the Unassigned card. */
  releaseId: string | null;
  sprints: Sprint[];
  epics: Epic[];
  folds: TimelineFolds;
}

export function FoldBar({ releaseId, sprints, epics, folds }: FoldBarProps) {
  const { data } = useBoard();
  const crew = (data?.agents ?? []).filter((a) => sprints.some((s) => s.id === a.sprint_id));

  const button = (kind: FoldKind, n: number, extra: ReactNode) => {
    const folded = folds.folded(releaseId, kind);
    const text = `${folded ? "▸" : "▾"} ${n} ${kind === "sprints" ? "sprint" : "epic"}${n === 1 ? "" : "s"}`;
    return (
      <button
        type="button"
        className={`tl-fold${folded ? " folded" : ""}`}
        title={`${folded ? "show" : "hide"} the ${kind}`}
        onClick={(e) => {
          e.stopPropagation();
          folds.setFold(releaseId, kind, !folded);
        }}
      >
        {text}
        {folded ? extra : null}
      </button>
    );
  };

  const crewInline = crew.length ? (
    <>
      {" · "}
      <span className="tl-crew-inline">
        {crew.map((a) => (
          <CrewChip key={a.id} agent={a} />
        ))}
      </span>
    </>
  ) : null;

  // The Unassigned card only shows its sprints button when it has loose sprints.
  return (
    <div className="tl-cardbar">
      {sprints.length || releaseId ? button("sprints", sprints.length, crewInline) : null}
      {button("epics", epics.length, null)}
    </div>
  );
}
