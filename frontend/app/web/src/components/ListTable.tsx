// The one list the app draws everywhere: a panel holding a table whose rows
// name a thing, describe it in a line beneath, tag it with a badge or two, and
// end in a "⋯" menu of what can be done to it. Pages describe their columns;
// this owns the markup, the states before there are rows, and the row menu.
//
// The projects list is the one table that cannot be expressed as flat rows
// (each project groups its versions beneath it), so it draws its own table on
// the same classes -- see features/projects/ProjectsList.tsx.
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RowMenu, RowMenuItem } from "./RowMenu";

export interface ListColumn<Row> {
  header: ReactNode;
  render: (row: Row) => ReactNode;
  /**
   * "primary" gives the column the slack (one per table); "when" keeps a date
   * on one line; "muted" dims the cell; "num" right-aligns a count.
   */
  className?: string;
}

interface ListTableProps<Row> {
  columns: ListColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Names the row in its menu's accessible label: "Actions for Acme Ltd". */
  rowLabel?: (row: Row) => string;
  /** The row's menu; return nothing for a row that offers no actions. */
  actions?: (row: Row) => RowMenuItem[] | null | undefined;
  loading?: boolean;
  error?: string | null;
  /** Shown in place of the table when there are no rows. */
  empty: ReactNode;
  /** A heading on the panel, for a list that is not the whole page. */
  title?: ReactNode;
}

export function ListTable<Row>({ columns, rows, rowKey, rowLabel, actions, loading, error, empty, title }: ListTableProps<Row>) {
  // The actions column is reserved as soon as any row could have a menu, so
  // rows with and without one keep the same shape.
  const menus = actions ? rows.map((row) => actions(row) ?? []) : [];
  const hasActions = menus.some((items) => items.length > 0);

  return (
    <section className="section list-panel">
      {title && (
        <div className="section-head">
          <h2>{title}</h2>
        </div>
      )}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : error ? (
        <div className="empty error">{error}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <table className="data-table list-table">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i} className={col.className}>
                  {col.header}
                </th>
              ))}
              {/* Unlabelled: a heading would be twice the width of the "⋯" it
                  names, and each menu says which row it acts on itself. */}
              {hasActions && <th className="actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={rowKey(row)}>
                {columns.map((col, i) => (
                  <td key={i} className={col.className}>
                    {col.render(row)}
                  </td>
                ))}
                {hasActions && (
                  <td className="actions">
                    {menus[r].length > 0 && (
                      <RowMenu label={rowLabel ? `Actions for ${rowLabel(row)}` : "Actions"} items={menus[r]} />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * The cell that names a row: the name itself, opening the thing where there is
 * somewhere to open it, with a quieter line beneath for its description.
 *
 * Opening is a link when it is a plain navigation, a button when it needs work
 * first (switching organisation, fetching a download URL); both read as the
 * same control.
 */
export function NameCell({
  children,
  sub,
  to,
  onOpen,
}: {
  children: ReactNode;
  sub?: ReactNode;
  to?: string;
  onOpen?: () => void;
}) {
  return (
    <>
      {to ? (
        <Link to={to} className="name">
          {children}
        </Link>
      ) : onOpen ? (
        <button type="button" className="btn-link name" onClick={onOpen}>
          {children}
        </button>
      ) : (
        <span className="name">{children}</span>
      )}
      {sub ? <span className="sub">{sub}</span> : null}
    </>
  );
}

/** A run of badges in one cell, wrapping rather than squashing. */
export function Badges({ children }: { children: ReactNode }) {
  return <span className="badges">{children}</span>;
}
