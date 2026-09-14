// The Docs section on the epic page: this epic's markdown docs, most recently
// updated first, each row opening the doc in the pane beside the epic. "+ Doc"
// creates an empty one and opens it straight into the editor -- there is
// no form, the doc IS the form. Ported from renderDocsSection() in the
// reference app's static/js/docs.js.
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import type { Epic } from "../board/epicsApi";
import { useToast } from "../board/toast";

interface DocsSectionProps {
  epic: Epic;
  selectedDoc: string | null;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
}

export function DocsSection({ epic, selectedDoc, onSelect, onCreated }: DocsSectionProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const toast = useToast();
  const docs = index.epicDocs(epic.id);

  const create = async () => {
    try {
      const d = await mutations.createDoc({ title: "New doc", body: "", tags: [], epic_id: epic.id });
      onCreated(d.id);
      toast(`${d.human_id} created — write markdown, then ✓ Done to save`);
    } catch {
      // Already toasted by the mutation layer.
    }
  };

  return (
    <>
      <div className="section-row">
        <h3>Docs ({docs.length})</h3>
        <span className="spacer" />
        {canWrite && (
          <button type="button" className="btn mini-x" title="new markdown doc in this epic" onClick={() => void create()}>
            + Doc
          </button>
        )}
      </div>
      <div className="epg-docs">
        {docs.length === 0 && <div className="hempty">No docs in this epic yet — specs, decisions, meeting notes, in markdown.</div>}
        {docs.map((d) => {
          const n = index.commentCount(d.id);
          return (
            <div key={d.id} className={`hrow${d.id === selectedDoc ? " sel" : ""}`} onClick={() => onSelect(d.id)}>
              <span className="k">{d.human_id}</span>
              <span className="t">{d.title}</span>
              <span className="r">
                {index.memberName(d.created_by)} · {d.updated_at.slice(0, 10)}
                {n > 0 ? ` · 💬${n}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
