// Low-fidelity schematic per component type, ported from
// schematics.global.js. Editable tokens (nav items, table cells, titles)
// become EditableToken components; "+" buttons call the edit handlers.
// With no `edit` handlers the schematic is read-only (viewers).
import { CSSProperties, ReactNode } from "react";
import { CustomDef } from "../model/actions";
import { getDefaultProps } from "../model/regions";
import { ComponentNode, RegionName } from "../model/types";
import { CustomSchematic } from "./CustomSchematic";
import { EditableToken } from "./InlineEdit";

export interface SchematicEdit {
  setPropValue(key: string, text: string): void;
  renamePropItem(key: string, index: number, text: string): void;
  setPropPath(path: string, text: string): void;
  addPropItem(key: string): void;
  addRow(): void;
  addColumn(): void;
  renameShellGroupTitle(groupIndex: number, text: string): void;
  addShellItem(groupIndex: number | null): void;
  renameShellItem(index: number, text: string, groupIndex: number | null): void;
}

interface Props {
  cmp: ComponentNode;
  region: RegionName | null;
  defs: readonly CustomDef[];
  edit?: SchematicEdit;
}

const SHELL_TYPES = new Set(["navbar", "nav-basic", "nav-search", "nav-cta", "sidebar", "sidenav-simple", "sidenav-grouped", "sidenav-workspace"]);

const Bar = ({ w, h, dim, style }: { w?: number | string; h?: number; dim?: boolean; style?: CSSProperties }) => (
  <div className={`sk-bar${dim ? " dim" : ""}`} style={{ width: w, height: h, ...style }} />
);

function stringItems(cmp: ComponentNode, key = "items"): string[] {
  const own = cmp.props?.[key];
  if (Array.isArray(own) && own.length) return own.map(String);
  const fallback = getDefaultProps(cmp.type)[key];
  return Array.isArray(fallback) ? fallback.map(String) : [];
}

function groups(cmp: ComponentNode): { title?: string; items: string[] }[] {
  const own = cmp.props?.groups;
  if (Array.isArray(own) && own.length) return own as { title?: string; items: string[] }[];
  const fallback = getDefaultProps(cmp.type).groups;
  return Array.isArray(fallback) ? (fallback as { title?: string; items: string[] }[]) : [];
}

function textProp(cmp: ComponentNode, key: string, fallback: string): string {
  const v = cmp.props?.[key];
  return v != null ? String(v) : fallback;
}

export function Schematic({ cmp, region, defs, edit }: Props) {
  const ro = !edit;
  const shellPill = (label: string, idx: number, groupIdx: number | null = null, accent = false, style?: CSSProperties) => (
    <EditableToken
      key={`${groupIdx}-${idx}`}
      className={`sk-pill${accent ? " accent" : ""} shell-pill`}
      style={{ width: "100%", justifyContent: "flex-start", ...style }}
      value={label}
      onCommit={edit ? (t) => edit.renameShellItem(idx, t, groupIdx) : undefined}
    />
  );
  const addShell = (groupIdx: number | null = null, compact = false) =>
    ro ? null : (
      <button
        type="button"
        className={`shell-add-btn${compact ? " compact" : ""}`}
        title="Add item"
        onClick={(e) => {
          e.stopPropagation();
          edit.addShellItem(groupIdx);
        }}
      >
        +
      </button>
    );
  const editableText = (key: string, fallback: string, className = "editable-text") => (
    <EditableToken className={className} value={textProp(cmp, key, fallback)} onCommit={edit ? (t) => edit.setPropValue(key, t) : undefined} />
  );
  const navLinks = (items: string[], style?: CSSProperties) => (
    <div className="links" style={style}>
      {items.map((item, idx) => (
        <EditableToken
          key={idx}
          className="sk-pill shell-pill"
          value={item}
          onCommit={edit ? (t) => edit.renameShellItem(idx, t, null) : undefined}
        />
      ))}
      {addShell(null, true)}
    </div>
  );

  let body: ReactNode;
  switch (cmp.type) {
    case "navbar":
    case "nav-basic":
      body = (
        <div className="nv">
          <Bar w={64} h={10} style={{}} />
          {navLinks(stringItems(cmp))}
          <div className="avatar" />
        </div>
      );
      break;
    case "nav-search":
      body = (
        <div className="nv">
          <Bar w={64} h={10} style={{ flexShrink: 0 }} />
          {navLinks(stringItems(cmp), { flex: 1, minWidth: 0 })}
          <div className="sk-input" style={{ flex: 1, maxWidth: 200, height: 20, borderRadius: 10 }} />
          <div className="avatar" style={{ marginLeft: "auto" }} />
        </div>
      );
      break;
    case "nav-cta":
      body = (
        <div className="nv">
          <Bar w={64} h={10} style={{ flexShrink: 0 }} />
          {navLinks(stringItems(cmp), { flex: 1 })}
          {editableText("ctaText", String(getDefaultProps(cmp.type).ctaText ?? "Get started"), "sk-pill accent editable-pill")}
          <div className="avatar" />
        </div>
      );
      break;
    case "sidebar":
    case "sidenav-simple": {
      const items = stringItems(cmp);
      const d = getDefaultProps(cmp.type);
      body =
        region === "sidebar" ? (
          <div className="sidebar-shell">
            <div className="section">
              <div className="title">{editableText("sectionTitle", String(d.sectionTitle ?? "Navigation"), "editable-title")}</div>
              {items.map((item, idx) => shellPill(item, idx, null, idx === 0))}
              {addShell()}
            </div>
            <div className="section" style={{ marginTop: "auto" }}>
              <div className="title">{editableText("workspaceTitle", String(d.workspaceTitle ?? "Workspace"), "editable-title")}</div>
              <Bar w="100%" dim />
              <Bar w="82%" dim />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 6 }}>
              {items.slice(0, 4).map((item, idx) => shellPill(item, idx, null, idx === 0, { width: 100 }))}
              {addShell()}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <Bar w="60%" h={10} />
              <Bar w="90%" dim />
              <Bar w="80%" dim />
            </div>
          </div>
        );
      break;
    }
    case "sidenav-grouped": {
      const gs = groups(cmp);
      body = (
        <div className="sidebar-shell">
          {gs.map((g, gIdx) => (
            <div key={gIdx} className="section" style={gIdx === gs.length - 1 ? { marginTop: "auto" } : undefined}>
              <div className="title">
                <EditableToken
                  className="editable-title"
                  value={g.title || `Group ${gIdx + 1}`}
                  onCommit={edit ? (t) => edit.renameShellGroupTitle(gIdx, t) : undefined}
                />
              </div>
              {(g.items ?? []).map((item, i) => shellPill(item, i, gIdx, gIdx === 0 && i === 0))}
              {addShell(gIdx)}
            </div>
          ))}
        </div>
      );
      break;
    }
    case "sidenav-workspace": {
      const d = getDefaultProps(cmp.type);
      body = (
        <div className="sidebar-shell">
          <div className="sk-input" style={{ height: 28, borderRadius: 6, marginBottom: 10 }} />
          <div className="section">
            <div className="title">{editableText("sectionTitle", String(d.sectionTitle ?? "Workspace"), "editable-title")}</div>
            {stringItems(cmp).map((item, idx) => shellPill(item, idx, null, idx === 0))}
            {addShell()}
          </div>
        </div>
      );
      break;
    }
    case "tabs":
      body = (
        <div className="sk-row">
          <span className="sk-pill accent">All</span>
          <span className="sk-pill">Active</span>
          <span className="sk-pill">Invited</span>
          <span className="sk-pill">Disabled</span>
        </div>
      );
      break;
    case "breadcrumb":
      body = (
        <div className="sk-row" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>
          Home <span style={{ opacity: 0.6 }}>/</span> Section <span style={{ opacity: 0.6 }}>/</span>
          <span style={{ color: "var(--text)" }}>Detail</span>
        </div>
      );
      break;
    case "footer":
      body = (
        <div className="sk-row" style={{ justifyContent: "space-between", color: "var(--text-mute)", fontSize: 11 }}>
          <span>© 2026 Acme</span>
          <span>Privacy · Terms · Support</span>
        </div>
      );
      break;
    case "hero":
      body = (
        <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <Bar w="60%" h={14} />
          <Bar w="80%" dim />
          <Bar w="70%" dim />
          <span className="sk-pill accent" style={{ marginTop: 4 }}>
            Get started ›
          </span>
        </div>
      );
      break;
    case "kpi":
      body = (
        <div className="kpi">
          {[["Users", "12,408", "+4.2%"], ["Active", "3,120", "+1.1%"], ["Revenue", "$84.3k", "+8.0%"], ["Churn", "1.4%", "-0.2%"]].map(([l, v, d]) => (
            <div key={l} className="tile">
              <div className="label">{l}</div>
              <div className="value">{v}</div>
              <div className="delta">{d}</div>
            </div>
          ))}
        </div>
      );
      break;
    case "list": {
      const d = getDefaultProps(cmp.type);
      const columns = (Array.isArray(cmp.props?.columns) && cmp.props.columns.length ? cmp.props.columns : d.columns) as string[];
      const rows = (Array.isArray(cmp.props?.rows) && cmp.props.rows.length ? cmp.props.rows : d.rows) as unknown[][];
      body = (
        <div>
          <table className="tbl">
            <thead>
              <tr>
                {columns.map((col, ci) => (
                  <th key={ci}>
                    <EditableToken className="tbl-edit" value={String(col)} onCommit={edit ? (t) => edit.setPropPath(`columns.${ci}`, t) : undefined} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {columns.map((_, ci) => (
                    <td key={ci}>
                      <EditableToken
                        className="tbl-edit"
                        value={row?.[ci] != null ? String(row[ci]) : ""}
                        onCommit={edit ? (t) => edit.setPropPath(`rows.${ri}.${ci}`, t) : undefined}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!ro && (
            <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button type="button" className="shell-add-btn" title="Add table column" onClick={(e) => (e.stopPropagation(), edit.addColumn())}>
                + col
              </button>
              <button type="button" className="shell-add-btn" title="Add table row" onClick={(e) => (e.stopPropagation(), edit.addRow())}>
                + row
              </button>
            </div>
          )}
        </div>
      );
      break;
    }
    case "chart":
      body = (
        <div className="chart">
          {[40, 55, 30, 72, 48, 65, 82, 58, 70, 90, 62, 78].map((h, i) => (
            <div key={i} className="b" style={{ height: `${h}%` }} />
          ))}
        </div>
      );
      break;
    case "detail":
      body = (
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 14px", fontSize: 12 }}>
          <div style={{ color: "var(--text-mute)" }}>Name</div><div>Ada Lovelace</div>
          <div style={{ color: "var(--text-mute)" }}>Email</div><div>ada@acme.io</div>
          <div style={{ color: "var(--text-mute)" }}>Status</div><div><span className="status active">Active</span></div>
          <div style={{ color: "var(--text-mute)" }}>Joined</div><div>Mar 4, 2025</div>
        </div>
      );
      break;
    case "empty":
      body = (
        <div style={{ textAlign: "center", padding: 18, color: "var(--text-mute)" }}>
          <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 4 }}>Nothing here yet</div>
          <div style={{ fontSize: 11, marginBottom: 10 }}>Get started by creating your first record.</div>
          <span className="sk-pill accent">Create record</span>
        </div>
      );
      break;
    case "main":
      body = (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
          <Bar w="40%" h={12} />
          <Bar w="90%" dim />
          <Bar w="85%" dim />
          <Bar w="60%" dim />
        </div>
      );
      break;
    case "form":
      body = (
        <div className="sk-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {["Name", "Email", "Role", "Team", "Notes", "Avatar"].map((f) => (
            <div key={f}>
              <div style={{ fontSize: 11, color: "var(--text-mute)", marginBottom: 4 }}>{f}</div>
              <div className="sk-input" />
            </div>
          ))}
        </div>
      );
      break;
    case "filters":
      body = (
        <div className="filters">
          <div className="sk-input search" />
          <span className="sk-pill">Role ▾</span>
          <span className="sk-pill">Joined ▾</span>
          <span className="sk-pill">Clear</span>
        </div>
      );
      break;
    case "stepper":
      body = (
        <div className="sk-row" style={{ gap: 14 }}>
          {["Account", "Profile", "Team", "Review"].map((s, i) => (
            <div key={s} className="sk-row" style={{ gap: 6, flex: i < 3 ? undefined : undefined }}>
              <div
                style={{
                  width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 10,
                  background: i === 1 ? "var(--accent)" : "var(--skeleton-dim)",
                  color: i === 1 ? "var(--on-accent)" : "var(--text-mute)",
                }}
              >
                {i + 1}
              </div>
              <span style={{ fontSize: 11, color: i === 1 ? "var(--text)" : "var(--text-mute)" }}>{s}</span>
              {i < 3 && <div className="sk-bar dim" style={{ width: 24, height: 2 }} />}
            </div>
          ))}
        </div>
      );
      break;
    case "modal":
      body = (
        <div style={{ border: "1px solid var(--border-strong)", borderRadius: 6, padding: 12, background: "var(--inset)" }}>
          <Bar w="50%" h={12} style={{ marginBottom: 8 }} />
          <Bar w="90%" dim />
          <Bar w="80%" dim style={{ marginTop: 6 }} />
          <div className="sk-row" style={{ justifyContent: "flex-end", marginTop: 10, gap: 6 }}>
            <span className="sk-pill">Cancel</span>
            <span className="sk-pill accent">Confirm</span>
          </div>
        </div>
      );
      break;
    case "actions":
      body = (
        <div className="sk-row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <span className="sk-pill">Cancel</span>
          <span className="sk-pill accent">Save changes</span>
        </div>
      );
      break;
    case "rightpanel-detail":
      body = (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Bar w="55%" h={11} />
          <Bar w="38%" h={8} dim />
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "6px 10px", fontSize: 11 }}>
            <div style={{ color: "var(--text-mute)" }}>Status</div><div><span className="status active">Active</span></div>
            <div style={{ color: "var(--text-mute)" }}>Email</div><div><Bar w="100%" dim /></div>
            <div style={{ color: "var(--text-mute)" }}>Role</div><div><Bar w="70%" dim /></div>
            <div style={{ color: "var(--text-mute)" }}>Joined</div><div><Bar w="60%" dim /></div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <span className="sk-pill">Edit</span>
            <span className="sk-pill" style={{ color: "#e06060" }}>Delete</span>
          </div>
        </div>
      );
      break;
    case "rightpanel-filters":
      body = (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Bar w="40%" h={9} />
          {["Status", "Date range", "Assigned to"].map((l) => (
            <div key={l}>
              <div style={{ fontSize: 10, color: "var(--text-mute)" }}>{l}</div>
              <div className="sk-input" style={{ height: 22 }} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <span className="sk-pill">Clear</span>
            <span className="sk-pill accent">Apply</span>
          </div>
        </div>
      );
      break;
    case "rightpanel-activity":
      body = (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Bar w="45%" h={9} />
          {[["Created record", "2m ago"], ["Updated status", "1h ago"], ["Added note", "3h ago"]].map(([a, t]) => (
            <div key={a} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <Bar w="80%" dim style={{ marginBottom: 3 }} />
                <div style={{ fontSize: 10, color: "var(--text-mute)" }}>{t}</div>
              </div>
            </div>
          ))}
        </div>
      );
      break;
    case "custom":
    case "editable-component": {
      const def = defs.find((d) => d.id === cmp.customId);
      body = def ? (
        <CustomSchematic def={def} />
      ) : cmp.type === "custom" ? (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>[custom: {cmp.customId ?? "?"}]</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Bar w="58%" h={10} />
          <Bar w="76%" dim />
          <div style={{ fontSize: 10, color: "var(--text-mute)" }}>Double-click or click ✎ to edit structure</div>
        </div>
      );
      break;
    }
    default:
      body = <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>[{cmp.type}]</div>;
  }

  // Generic editable item chips for non-shell, non-table components.
  const generic = !SHELL_TYPES.has(cmp.type) && cmp.type !== "list" ? stringItems(cmp) : [];

  return (
    <div>
      {body}
      {generic.length > 0 && (
        <div className="prop-items">
          {generic.map((item, idx) => (
            <EditableToken
              key={idx}
              className="sk-pill prop-pill"
              value={item}
              onCommit={edit ? (t) => edit.renamePropItem("items", idx, t) : undefined}
            />
          ))}
          {!ro && (
            <button type="button" className="shell-add-btn compact" title="Add item" onClick={(e) => (e.stopPropagation(), edit.addPropItem("items"))}>
              +
            </button>
          )}
        </div>
      )}
    </div>
  );
}
