// Illustrations for the landing page, drawn in HTML/CSS so they prerender
// with the copy and never go stale the way a screenshot would.
//
// The wireframe sketches borrow the canvas's graphite-on-paper look (the
// .device palette in studio.css) rather than the brand, for the same reason
// the canvas does: a wireframe carries no visual decisions. Orange appears
// only where the editor's own chrome would show it: a selection outline, a
// divider grip, a link. Everything here is static markup with no state, so
// the server render and the hydrated client render are identical.
import type { ReactNode } from "react";

/* ── JSON, coloured deterministically ─────────────────────────────────── */

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(\d+)|([{}[\],])/g;

function JsonLine({ line }: { line: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    if (m[1] !== undefined) {
      out.push(
        <span key={i++} className={m[2] ? "j-k" : "j-s"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(
        <span key={i++} className="j-n">
          {m[3]}
        </span>,
      );
    } else {
      out.push(
        <span key={i++} className="j-p">
          {m[4]}
        </span>,
      );
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return <>{out}</>;
}

export function Json({ src, className }: { src: string; className?: string }) {
  const lines = src.trim().split("\n");
  return (
    <pre className={"art-json" + (className ? " " + className : "")}>
      {lines.map((l, n) => (
        <span key={n} className="j-line">
          <JsonLine line={l} />
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/* ── Wireframe primitives ─────────────────────────────────────────────── */

const JOBS = [
  ["JB-1041", "Boiler service", "Ada L.", "Assigned"],
  ["JB-1042", "Meter replacement", "Grace H.", "Open"],
  ["JB-1043", "Leak inspection", "Linus T.", "Done"],
  ["JB-1044", "Annual safety check", "Ada L.", "Open"],
];

function JobsTable({ selectColumn }: { selectColumn?: string }) {
  const cols = ["Job", "Description", "Crew", "Status"];
  return (
    <table className="wf-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} className={selectColumn === c ? "wf-sel" : undefined}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {JOBS.map((r) => (
          <tr key={r[0]}>
            <td className="wf-mono">{r[0]}</td>
            <td>{r[1]}</td>
            <td>{r[2]}</td>
            <td>
              <span className={"wf-pill " + r[3].toLowerCase()}>{r[3]}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ListHead() {
  return (
    <div className="wf-list-head">
      <span className="wf-h">Jobs</span>
      <span className="wf-search">Search</span>
      <span className="wf-btn">New job</span>
    </div>
  );
}

function TopNav({ active }: { active?: string }) {
  return (
    <div className="wf-nav">
      <span className="wf-brand">FieldOps</span>
      {["Jobs", "Crews", "Reports"].map((i) => (
        <span key={i} className={"wf-item" + (active === i ? " on" : "")}>
          {i}
        </span>
      ))}
      <span className="wf-spacer" />
      <span className="wf-avatar">JS</span>
    </div>
  );
}

function SideNav() {
  return (
    <div className="wf-side">
      {["Open", "Assigned", "Done", "Archive"].map((i, n) => (
        <span key={i} className={n === 0 ? "on" : undefined}>
          {i}
        </span>
      ))}
    </div>
  );
}

/* ── Hero: the page on the left, what it means on the right ───────────── */

const HERO_JSON = `
{
  "name": "Jobs",
  "route": "/jobs",
  "layout": {
    "kind": "split",
    "dir": "col",
    "children": [
      {
        "kind": "region",
        "size": "auto",
        "components": [
          {
            "type": "navbar",
            "variant": "plain",
            "elements": [
              { "type": "brand", "label": "FieldOps" },
              { "type": "nav-item", "label": "Jobs",
                "props": { "links": [{ "page": "p-jobs" }] } },
              { "type": "nav-item", "label": "Crews",
                "props": { "links": [{ "page": "p-crews" }] } },
              { "type": "avatar", "label": "JS" }
            ]
          }
        ]
      },
      {
        "kind": "split",
        "dir": "row",
        "children": [
          {
            "kind": "region",
            "size": 200,
            "components": [
              { "type": "navbar", "layout": "vertical", "elements": [
                { "type": "nav-item", "label": "Open" },
                { "type": "nav-item", "label": "Assigned" }
              ] }
            ]
          },
          {
            "kind": "region",
            "size": { "fr": 1 },
            "components": [
              {
                "type": "list",
                "variant": "table",
                "elements": [
                  { "type": "header", "label": "Jobs" },
                  { "type": "column", "label": "Job",
                    "data": { "kind": "text" } },
                  { "type": "column", "label": "Crew",
                    "data": { "kind": "text" } },
                  { "type": "column", "label": "Status",
                    "data": { "kind": "status", "dataset": "ds-job-status" } },
                  { "type": "search" },
                  { "type": "button", "label": "New job",
                    "props": { "links": [{ "page": "p-job-new" }] } }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
`;

export function HeroArt() {
  return (
    <div className="art hero-art" aria-hidden="true">
      <div className="art-chrome">
        <span className="art-crumb">Dispatcher console</span>
        <span className="art-crumb-sep">/</span>
        <span className="art-crumb on">Jobs</span>
        <span className="art-chip">v4</span>
        <span className="wf-spacer" />
        <span className="art-chip">Preview</span>
        <span className="art-chip">Export</span>
      </div>
      <div className="art-body">
        <div className="wf-paper">
          <TopNav active="Jobs" />
          <div className="wf-split">
            <SideNav />
            <div className="wf-main">
              <ListHead />
              <JobsTable />
            </div>
          </div>
        </div>
        <Json src={HERO_JSON} className="hero-json" />
      </div>
    </div>
  );
}

/* ── Step 01: the page is a tree of regions ───────────────────────────── */

export function SplitArt() {
  return (
    <div className="art step-art" aria-hidden="true">
      <div className="wf-paper sk">
        <div className="sk-region top">
          <span className="sk-tag">auto</span>
        </div>
        <div className="sk-divider h">
          <span className="sk-grip" />
        </div>
        <div className="sk-row">
          <div className="sk-region">
            <span className="sk-tag">200px</span>
          </div>
          <div className="sk-divider v">
            <span className="sk-grip" />
          </div>
          <div className="sk-region">
            <span className="sk-tag">1fr</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Step 02: components made of typed elements ───────────────────────── */

export function ConfigureArt() {
  return (
    <div className="art step-art" aria-hidden="true">
      <div className="wf-paper">
        <div className="wf-main">
          <ListHead />
          <JobsTable selectColumn="Status" />
        </div>
      </div>
      <div className="art-callout">
        <span className="art-callout-k">column</span>
        <span className="art-callout-v">Status</span>
        <span className="art-callout-k">data kind</span>
        <span className="art-callout-v">status</span>
        <span className="art-callout-k">dataset</span>
        <span className="art-callout-v">Job status</span>
      </div>
    </div>
  );
}

/* ── Step 03: links target a page, or one region of it ────────────────── */

export function LinkArt() {
  return (
    <div className="art step-art link-art" aria-hidden="true">
      <div className="wf-paper">
        <TopNav active="Jobs" />
        <div className="wf-split">
          <SideNav />
          <div className="wf-main outlet">
            <span className="sk-tag">Nav &rsaquo; Main</span>
          </div>
        </div>
      </div>
      <svg className="link-arrow" viewBox="0 0 120 60" width="120" height="60">
        <path d="M4 30 C 40 30, 60 30, 108 30" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M100 22 L 112 30 L 100 38" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <div className="wf-paper child">
        <div className="wf-main">
          <ListHead />
          <JobsTable />
        </div>
      </div>
    </div>
  );
}

/* ── Step 04: one envelope leaves ─────────────────────────────────────── */

export function ExportArt() {
  const parts = ["Personas", "Use cases", "Diagrams", "Datasets", "Wireframes"];
  return (
    <div className="art step-art export-art" aria-hidden="true">
      <ul className="export-parts">
        {parts.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <span className="export-brace">{"{ }"}</span>
    </div>
  );
}

/* ── The project envelope, as the export route returns it ─────────────── */

export const ENVELOPE_JSON = `
{
  "schemaVersion": "1.0",
  "projectName": "Field Ops",
  "rationale": "Dispatchers lose an hour a day chasing job status by phone.",
  "personas": [
    { "name": "Dispatcher", "role": "Operations",
      "jobsToBeDone": ["Assign the right crew fast"] }
  ],
  "diagrams": [
    { "name": "Job lifecycle", "kind": "state", "model": { } }
  ],
  "datasets": [
    { "name": "Job status", "values": ["Open", "Assigned", "Done"] }
  ],
  "wireframes": [
    {
      "name": "Dispatcher console",
      "interfaceType": "desktop",
      "userTypes": [{ "name": "Dispatcher" }],
      "pages": [
        { "name": "Jobs", "route": "/jobs", "layout": { } },
        { "name": "New job", "route": "/jobs/new",
          "presentation": "modal", "layout": { } }
      ]
    }
  ]
}
`;
