// A wireframe `list` with shape `table`: header, toolbar (search, the
// record-status filter, extra filters), columns, row actions, pagination.
// Archive and Delete work on the rows in memory; Edit and links follow the
// wireframe's `props.links`.
import { ReactNode, useMemo, useState } from "react";
import { RECORD_STATUS } from "../data";
import { useGo } from "../lib/nav";
import { Avatar, Button, EmptyState, PageHeader, SearchBox, Select, StatusBadge, useToast } from "./controls";
import { Icon } from "./icons";

export type Row = { id: string; archived?: boolean } & Record<string, string | boolean | undefined>;

export interface Column {
  key: string;
  label: string;
  kind?: "text" | "status" | "date" | "number" | "email" | "person" | "select" | "button" | "datetime-input";
  /** A page this column's cells link to. */
  link?: string;
  /** For kind "select": the choices each cell offers. */
  options?: string[];
  /** Called with the row before following `link` (e.g. to say which record). */
  onFollow?: (row: Row) => void;
  /** Keeps a wide column from wrapping. */
  nowrap?: boolean;
}

export interface RowAction {
  label: string;
  /** Opens this page (usually a drawer). */
  pageId?: string;
  /** Works on the row in memory. */
  does?: "archive" | "delete";
  onFollow?: (row: Row) => void;
}

export function DataTable({
  title,
  titleLevel = "page",
  columns,
  rows: initialRows,
  rowActions = [],
  create,
  search = true,
  statusFilter = false,
  selectable = false,
  pageSize,
  filters,
  toolbarEnd,
  noun = "item",
  intro,
}: {
  title?: string;
  titleLevel?: "page" | "section";
  columns: Column[];
  rows: Row[];
  rowActions?: RowAction[];
  create?: { label: string; pageId: string; placement?: "above" | "inline" };
  search?: boolean;
  statusFilter?: boolean;
  selectable?: boolean;
  pageSize?: number;
  filters?: ReactNode;
  toolbarEnd?: ReactNode;
  noun?: string;
  intro?: ReactNode;
}) {
  const go = useGo();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Active");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && status === "Active" && row.archived) return false;
      if (statusFilter && status === "Archived" && !row.archived) return false;
      if (!q) return true;
      return columns.some((column) =>
        String(row[column.key] ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [rows, query, status, statusFilter, columns]);

  const pages = pageSize ? Math.max(1, Math.ceil(visible.length / pageSize)) : 1;
  const current = Math.min(page, pages - 1);
  const shown = pageSize ? visible.slice(current * pageSize, current * pageSize + pageSize) : visible;

  const createButton = create && (
    <Button variant="primary" icon="plus" onClick={() => go(create.pageId)}>
      {create.label}
    </Button>
  );

  const act = (action: RowAction, row: Row) => {
    action.onFollow?.(row);
    if (action.pageId) return go(action.pageId);
    if (action.does === "archive") {
      setRows((all) => all.map((r) => (r.id === row.id ? { ...r, archived: !r.archived } : r)));
      toast(row.archived ? `Restored. It's back in the active list.` : `Archived. You'll find it under Archived.`);
    }
    if (action.does === "delete") {
      setRows((all) => all.filter((r) => r.id !== row.id));
      toast("Deleted.");
    }
  };

  const allChecked = shown.length > 0 && shown.every((row) => selected.has(row.id));

  return (
    <section className="table-block">
      {title &&
        (titleLevel === "page" ? (
          <PageHeader title={title} actions={create?.placement !== "inline" ? createButton : undefined}>
            {intro}
          </PageHeader>
        ) : (
          <div className="section-head">
            <h2>{title}</h2>
            {create?.placement !== "inline" && createButton}
          </div>
        ))}
      {(search || statusFilter || filters || toolbarEnd || (create && (create.placement === "inline" || !title))) && (
        <div className="toolbar">
          {search && (
            <SearchBox
              value={query}
              onChange={(value) => (setQuery(value), setPage(0))}
              label={`Search ${title ?? noun}`}
            />
          )}
          {statusFilter && (
            <Select
              compact
              ariaLabel="Status"
              options={RECORD_STATUS}
              value={status}
              onChange={(value) => (setStatus(value), setPage(0))}
            />
          )}
          {filters}
          <span className="toolbar-spacer" />
          {toolbarEnd}
          {create && (create.placement === "inline" || !title) && createButton}
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {selectable && (
                <th className="cell-check">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((row) => row.id)))}
                  />
                </th>
              )}
              {columns.map((column) => (
                <th key={column.key} className={column.kind === "number" ? "num" : undefined}>
                  {column.label}
                </th>
              ))}
              {rowActions.length > 0 && (
                <th className="cell-actions">
                  <span className="visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} className={row.archived ? "is-archived" : undefined}>
                {selectable && (
                  <td className="cell-check">
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={selected.has(row.id)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`${column.kind === "number" ? "num" : ""}${column.nowrap ? " nowrap" : ""}`}
                  >
                    <Cell
                      column={column}
                      row={row}
                      onFollow={() => (column.onFollow?.(row), column.link && go(column.link))}
                    />
                  </td>
                ))}
                {rowActions.length > 0 && (
                  <td className="cell-actions">
                    <div className="row-actions">
                      {rowActions.map((action) => (
                        <Button key={action.label} variant="ghost" size="sm" onClick={() => act(action, row)}>
                          {action.does === "archive" && row.archived ? "Restore" : action.label}
                        </Button>
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <EmptyState title={rows.length === 0 ? `No ${noun}s yet` : `No matching ${noun}s`}>
            {rows.length === 0 ? "Create your first one to get started." : "Try a different search or status."}
          </EmptyState>
        )}
      </div>

      {pageSize && visible.length > 0 && (
        <div className="pagination">
          <span>
            {current * pageSize + 1}–{Math.min(visible.length, (current + 1) * pageSize)} of {visible.length}
          </span>
          <div className="pagination-buttons">
            <Button size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <Button size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Cell({ column, row, onFollow }: { column: Column; row: Row; onFollow: () => void }) {
  const value = String(row[column.key] ?? "");
  switch (column.kind) {
    case "status":
      return <StatusBadge value={row.archived ? "Archived" : value} />;
    case "select":
      return <Select compact ariaLabel={column.label} options={column.options ?? []} defaultValue={value} />;
    case "button":
      return (
        <Button size="sm" onClick={onFollow}>
          {value || "Edit"}
        </Button>
      );
    case "datetime-input":
      return <input className="input input-sm" type="datetime-local" aria-label={column.label} defaultValue={value} />;
    case "person":
      return (
        <span className="person">
          <Avatar name={value} size={24} src={typeof row.image === "string" ? row.image : undefined} />
          {column.link ? (
            <button className="link" onClick={onFollow}>
              {value}
            </button>
          ) : (
            value
          )}
        </span>
      );
    case "email":
      return <span className="muted">{value}</span>;
    default:
      return column.link ? (
        <button className="link" onClick={onFollow}>
          {value}
          <Icon name="chevron" size={12} className="link-chevron" />
        </button>
      ) : (
        <>{value}</>
      );
  }
}
