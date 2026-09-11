// The sprint board's live column: one GET every ten seconds while the board
// is open, folded into the shared board (the sprint, its requirements, its
// agents) plus the events and agent questions kept here. A poll never
// redraws over something you are doing -- the caller says when to hold off
// (a drag in flight, a focused answer box) and the result waits for the
// next tick. A failed poll goes quiet; a 404 means the sprint is gone.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../../core/api";
import { useBoard } from "./boardData";
import { getSprintActivity, SprintActivity } from "./sprintsApi";

export const SPRINT_POLL_MS = 10000;

export interface SprintLive {
  live: SprintActivity | null;
  gone: boolean;
  /** Fetch now; `force` applies the result even while the caller is busy. */
  refresh: (force?: boolean) => Promise<void>;
}

export function useSprintActivity(sprintId: string, isBusy: () => boolean): SprintLive {
  const board = useBoard();
  const boardRef = useRef(board);
  boardRef.current = board;
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;
  const [live, setLive] = useState<SprintActivity | null>(null);
  const [gone, setGone] = useState(false);
  const goneRef = useRef(false);

  const apply = useCallback((a: SprintActivity) => {
    const b = boardRef.current;
    b.replace("sprints", a.sprint);
    for (const r of a.requirements) b.replace("requirements", r);
    for (const ag of a.agents) b.replace("agents", ag);
    // Anything we thought was in this sprint but the server no longer lists
    // has left (moved by an agent, or another tab): refresh the requirements
    // rather than keep a stale claim.
    const fresh = new Set(a.requirements.map((r) => r.id));
    const stale = b.data?.requirements.some((r) => r.sprint_id === a.sprint.id && !fresh.has(r.id));
    if (stale) void b.reload(["requirements"]);
    setLive(a);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (goneRef.current) return;
      let a: SprintActivity;
      try {
        a = await getSprintActivity(boardRef.current.projectId, sprintId, 60);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          goneRef.current = true;
          setGone(true);
          boardRef.current.remove("sprints", sprintId);
        }
        return;
      }
      if (!force && busyRef.current()) return;
      apply(a);
    },
    [sprintId, apply],
  );

  useEffect(() => {
    goneRef.current = false;
    setGone(false);
    setLive(null);
    void refresh(true);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void refresh(false);
    }, SPRINT_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { live, gone, refresh };
}
