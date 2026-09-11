// Jump to any board entity from a feed link or a comment: a release opens
// its page, a sprint its board, an epic its page, a feature its epic's page;
// a requirement opens on its sprint's board with the drawer up, or on its
// epic's page with the pane up,
// or -- with neither -- on the roadmap with the drawer up; a doc opens on its
// epic's page, and an unfiled doc asks which epic to file it under first.
// Ported from the reference app's goTo() (static/js/activity.js).
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useBoard } from "./boardData";
import { useBoardMutations } from "./boardMutations";
import { useDialogs } from "./dialogs";
import { useToast } from "./toast";

export type GoTo = (entityType: string, entityId: string) => void;

export function useGoTo(): GoTo {
  const navigate = useNavigate();
  const { paths, index } = useBoard();
  const dialogs = useDialogs();
  const mutations = useBoardMutations();
  const toast = useToast();

  return useCallback(
    (entityType, entityId) => {
      switch (entityType) {
        case "release":
          navigate(paths.release(entityId));
          return;
        case "sprint":
          navigate(paths.sprint(entityId));
          return;
        case "epic":
          navigate(paths.epic(entityId));
          return;
        case "feature": {
          const f = index.featureById.get(entityId);
          if (f) navigate(paths.epic(f.epic_id));
          return;
        }
        case "requirement": {
          const r = index.requirementById.get(entityId);
          if (!r) return;
          if (r.sprint_id && index.sprintById.has(r.sprint_id)) {
            navigate(paths.sprint(r.sprint_id, { req: r.id }));
            return;
          }
          const eid = index.effectiveEpicId(r);
          navigate(eid ? paths.epic(eid, { req: r.id }) : `${paths.roadmap}?req=${r.id}`);
          return;
        }
        case "doc": {
          const d = index.docById.get(entityId);
          if (!d) return;
          if (d.epic_id) {
            navigate(paths.epic(d.epic_id, { doc: d.id }));
            return;
          }
          void (async () => {
            const eid = await dialogs.pick({
              title: `File ${d.human_id} under an epic`,
              items: index.epics.map((e) => ({ value: e.id, label: `${e.human_id} · ${e.title}` })),
            });
            if (!eid) return;
            const filed = await mutations.patchDoc(d.id, { epic_id: eid });
            toast(`${filed.human_id} filed under ${index.epicById.get(eid)?.human_id ?? "the epic"}`);
            navigate(paths.epic(eid, { doc: filed.id }));
          })();
          return;
        }
        default:
          return;
      }
    },
    [navigate, paths, index, dialogs, mutations, toast],
  );
}
