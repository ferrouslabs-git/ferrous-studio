// Epics > Archived: every archived requirement in the project, with or
// without an epic. Archived requirements are not on the shared board
// (FS-REQ-79), so the page fetches them itself; the epic page's "Show
// archived" only reaches the ones filed under an epic, and this is the one
// place the rest can be found again. Restore puts a requirement back on the
// board; Delete is only offered here, since only an archived one can go.
import { useMemo, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { formatDate } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { useBoard } from "../board/boardData";
import { useBoardMutations } from "../board/boardMutations";
import { deleteRequirement, listRequirements, Requirement } from "../board/requirementsApi";
import { useToast } from "../board/toast";

/** The epic filter's entry for "no epic" -- no epic has this id. */
const NO_EPIC = "__none__";

export function ArchivedRequirementsPage() {
  const { projectId, index, canWrite, paths, reload } = useBoard();
  const mutations = useBoardMutations();
  const toast = useToast();
  const archived = useLoad(() => listRequirements(projectId, { archived: "only" }), [projectId]);
  const [query, setQuery] = useState("");
  const [epicFilter, setEpicFilter] = useState("");
  const [deleting, setDeleting] = useState<Requirement | null>(null);

  // A requirement under a feature belongs to the feature's epic; one whose
  // epic has since been deleted counts as having none.
  const epicOf = (r: Requirement) => {
    const id = r.effective_epic_id ?? r.epic_id;
    return id ? index.epicById.get(id) : undefined;
  };

  const all = useMemo(
    () => [...(archived.data ?? [])].sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? "")),
    [archived.data],
  );
  const visible = all.filter((r) => {
    const epic = epicOf(r);
    if (epicFilter === NO_EPIC ? epic : epicFilter && epic?.id !== epicFilter) return false;
    return matches(query, r.human_id, r.title, epic?.human_id, epic?.title);
  });
  const filtered = query.trim() !== "" || epicFilter !== "";

  const restore = async (r: Requirement) => {
    try {
      await mutations.restoreRequirement(r);
      await archived.reload();
    } catch {
      // Already toasted.
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Archived requirements</h1>
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by id, title or epic", label: "Search archived requirements" }}
        filters={[
          {
            label: "Filter by epic",
            value: epicFilter,
            onChange: setEpicFilter,
            options: [
              { value: "", label: "All epics" },
              { value: NO_EPIC, label: "No epic" },
              ...index.epics.map((e) => ({ value: e.id, label: `${e.human_id} · ${e.title}` })),
            ],
          },
        ]}
        count={{ visible: visible.length, total: all.length, noun: ["archived requirement", "archived requirements"] }}
      />

      <ListTable
        columns={[
          {
            header: "Requirement",
            className: "primary",
            render: (r) => <NameCell sub={r.human_id}>{r.title}</NameCell>,
          },
          {
            header: "Epic",
            render: (r) => {
              const epic = epicOf(r);
              return epic ? <NameCell to={paths.epic(epic.id)}>{`${epic.human_id} · ${epic.title}`}</NameCell> : <span className="muted">No epic</span>;
            },
          },
          {
            header: "Feature",
            className: "muted",
            render: (r) => {
              const feature = r.feature_id ? index.featureById.get(r.feature_id) : undefined;
              return feature ? `${feature.human_id} · ${feature.title}` : "—";
            },
          },
          { header: "Archived", className: "muted when", render: (r) => (r.archived_at ? formatDate(r.archived_at) : "—") },
        ]}
        rows={visible}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.human_id}
        actions={(r) =>
          canWrite
            ? [
                { label: "Restore", onSelect: () => void restore(r) },
                { label: "Delete", danger: true, onSelect: () => setDeleting(r) },
              ]
            : null
        }
        loading={archived.loading}
        error={archived.error}
        empty={filtered ? "No archived requirements match these filters." : "No archived requirements."}
      />

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete requirement"
        confirmLabel="Delete requirement"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          // The raw call, not the board mutation: a refusal is shown in the
          // drawer rather than toasted behind it.
          await deleteRequirement(projectId, deleting.id);
          toast(`${deleting.human_id} deleted`);
          void reload(["comments"]);
          await archived.reload();
        }}
      >
        <p>
          Permanently delete <b>{deleting?.human_id}</b> “{deleting?.title}”? Its comments go with it. This cannot be undone.
        </p>
      </ConfirmDrawer>
    </div>
  );
}
