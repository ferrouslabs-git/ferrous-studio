# Visual Spec UI Builder — Mockup

A zero-dependency, browser-native tool for visually composing page specifications. Drag library components onto a canvas, arrange them into layout regions, inspect state as live JSON, and export the result — all without a build step or server.

---

## Philosophy

Most design tools produce pictures. This tool produces **structured intent**.

The core belief is that a page spec should be a data contract, not a Figma frame. When a designer drags a `Data Table` into the `main` region of a `Dashboard` frame, they are not choosing a colour or a pixel size — they are stating: *"this page needs a data table here."* That statement should be machine-readable from the moment it is made.

A few guiding principles:

- **Structure over style.** The mockup captures *what* goes on a page and *where*, not what it looks like. Visual polish is left to the real implementation.
- **Pages are data.** Every action produces a plain JSON state object. There is no hidden format — what you see in the inspector is the full truth of the spec.
- **No lock-in.** Because the output is plain JSON with no proprietary schema, any tool or language can read it. The spec belongs to the team, not to the tool.
- **Friction-free entry.** No account, no install, no server. A designer or product manager can open `mockup.html`, build a spec in minutes, and hand off the JSON to an engineer.
- **Components as vocabulary.** The component library is a shared language between design and engineering. When both sides agree that a `Kanban Board` is a single unit, conversations stop being about pixels and start being about behaviour.

---

## Architecture: Three Layers

This tool is built on a strict separation of three concerns. Understanding these layers is essential for anyone consuming the JSON output.

```
┌─────────────────────────────────────────────────────┐
│  1. SPEC LAYER          (this tool produces this)   │
│     pages › frames › regions › components           │
│     Regions are named slots — not DOM nodes         │
├─────────────────────────────────────────────────────┤
│  2. LAYOUT COMPILER     (the consumer implements)   │
│     reads layoutTemplate + active regions           │
│     maps each region name → a positional slot       │
│     in the chosen layout template                   │
├─────────────────────────────────────────────────────┤
│  3. RENDER LAYER        (React / DOM / any UI)      │
│     receives the resolved slot tree                 │
│     produces actual DOM children                    │
│     CSS handles all visual positioning              │
└─────────────────────────────────────────────────────┘
```

### The critical distinction

**Regions are not converted into children directly.** They are compiled into positional slots inside a layout template, and that template produces the child tree.

```
// ❌ Wrong mental model
regions → children

// ✅ Correct pipeline
regions → layout resolution → render tree → DOM children
```

Concretely, when the spec says `sidebar` is active, the layout compiler does not append a `<div>` called sidebar into a parent list. It looks up the `layoutTemplate` (e.g. `"dashboard"`), finds the fixed slot named `left`, and fills it with the sidebar's components. The DOM hierarchy is the template's concern — not the spec's.

This keeps layout meaning intact, enforces structural constraints, and makes it safe to change a layout template without touching the component data.

### What the consuming engineer builds

```js
// Pseudocode for a layout compiler
function compilePage(frame) {
  const template = LAYOUT_TEMPLATES[frame.layout.layoutTemplate];
  const slots = template.slots; // e.g. { top, left, center, bottom }

  // Map region names → slot positions
  slots.top    = resolveRegion(frame, 'header');
  slots.left   = resolveRegion(frame, 'sidebar');
  slots.center = resolveRegion(frame, 'main');
  slots.bottom = resolveRegion(frame, 'footer');

  return template.render(slots); // produces the DOM tree
}
```

The spec layer (this tool) never needs to know about `slots.top` or `slots.left`. It only stores intent. The compiler owns the mapping.

---

## How This Mockup Works in Real Scenarios

The mockup is not a prototype — it is a **specification generator**. Here is how it fits into a real product workflow:

### 1. Product Discovery
A product manager opens the tool, creates pages matching the planned navigation structure (e.g., Dashboard, Users, Settings), and drops high-level components into each page to communicate scope. The output JSON is attached to a ticket or stored in a repo as the source of truth for what needs to be built.

### 2. Design Handoff
A designer refines the spec by adjusting layout regions (enabling a sidebar for the admin view, using a 3-column main flow for a dashboard), adding frame variants (Default, Mobile, Tablet), and filling in component-level props. The JSON diff between iterations gives engineers a precise change log — no more "spot the difference" between two Figma versions.

### 3. Engineering Scaffolding
An engineer reads the exported JSON and generates boilerplate automatically. Because each component entry has a known `type`, `region`, and `props`, a code generator can:
- Create a route and page file for each page object
- Place the correct component in the correct layout slot
- Wire up responsive breakpoints from the frame variants

The JSON schema is intentionally simple so that writing such a generator takes hours, not weeks.

### 4. Review & Iteration
Stakeholders can open the mockup, load a saved JSON spec, and see the structure of every page at a glance — without needing a running application. Change requests are made directly in the tool and the updated JSON is re-exported. Because there is no visual noise (no colours, no real content), reviews stay focused on structure and flow.

### 5. Living Documentation
The spec JSON can be committed to version control alongside the source code. As the product evolves, the mockup file evolves too, giving new team members an always-current map of the application's page structure without reading the entire codebase.

---

## Opening

Double-click `mockup.html`. No server, no npm, no build step required.

---

## File Structure

```
page_definition/
├── mockup.html          # HTML shell — loads CSS + all scripts in order
├── css/
│   └── styles.css       # All styling: themes, layout grid, builder overlay, scrollbar
└── js/
    ├── data.js           # Static catalogs: component types, default labels, patterns
    ├── state.js          # State object, region helpers, uid generator, active-frame getters
    ├── schematics.global.js  # Schematic HTML rendered per component type on the canvas
    ├── mutations.global.js   # All state mutations: page/frame CRUD, component add/move/remove
    ├── dnd.global.js     # Canvas and region drag-and-drop event handlers
    ├── builder.global.js # Component Builder modal: create/edit/delete custom components
    ├── render.global.js  # All DOM render functions and toast helper
    └── app.global.js     # Bootstrap: wires event listeners, theme, calls renderAll()
```

### Script Load Order

Scripts are loaded via `<script defer src="...">` in dependency order:

```
data.js → state.js → schematics.global.js → mutations.global.js →
dnd.global.js → builder.global.js → render.global.js → app.global.js
```

All modules share the `window.VSUB` namespace (classic scripts, not ES modules) so the page works when opened directly from the filesystem over `file://`.

---

## Features

### Layout Regions
Each frame supports up to four named regions arranged in a CSS grid:

| Region   | Position          |
|----------|-------------------|
| `header` | Top bar           |
| `sidebar`| Left rail         |
| `main`   | Primary content   |
| `footer` | Bottom bar        |

Regions are toggled per-frame in the inspector. Enabling `sidebar` docks it as a left rail; components placed there render with a `cmp-shell-sidebar` shell.

### Main Flow
For the `main` region, three layout modes are available:

- **Stack** — single column, components stacked vertically
- **2-col** — two-column side-by-side
- **3-col** — three-column grid

### Smart Dock
A per-frame toggle (`smartDock`) that automatically pins shell-type components (navbar, sidebar, footer) to their matching region.

### Drag & Drop
Components are dragged from the library panel on the left and dropped onto the canvas. The drag payload uses the MIME type `application/x-vsub` with a JSON body. Drop indicators appear on valid targets.

### Component Builder
A modal (opened via the **+** button in the library) for creating and editing custom component definitions. Supports:

- Custom name, icon, and icon colour
- Slot definitions (each slot has a name and type: `text`, `image`, `action`, `list`)

Custom components appear in the library alongside built-in types and behave identically on the canvas.

### Themes
Light and dark themes are toggled via the toolbar. The current theme is persisted to `localStorage` under the key `vsub-theme`. All colours are driven by CSS custom properties (`--bg`, `--panel`, `--accent`, etc.).

### Multi-page / Multi-frame
Projects can have multiple pages, each with multiple frames (e.g., Default, Mobile, Tablet). Pages and frames have independent region configs, component lists, and layout settings.

### JSON Inspector
The right panel shows the live serialised state of the active frame. Output is syntax-highlighted and updates on every change.

---

## Built-in Component Types

| ID             | Label              |
|----------------|--------------------|
| `navbar`       | Navigation Bar     |
| `sidebar`      | Sidebar            |
| `hero`         | Hero Banner        |
| `card-grid`    | Card Grid          |
| `list`         | List / Table       |
| `form`         | Form               |
| `modal`        | Modal / Dialog     |
| `chart`        | Chart / Graph      |
| `tabs`         | Tabs               |
| `footer`       | Footer             |
| `text-block`   | Text Block         |
| `image`        | Image              |
| `button`       | Button             |
| `badge`        | Badge / Tag        |
| `alert`        | Alert / Banner     |
| `breadcrumb`   | Breadcrumb         |
| `pagination`   | Pagination         |
| `stepper`      | Stepper / Wizard   |
| `calendar`     | Calendar           |
| `map`          | Map                |
| `media-player` | Media Player       |
| `data-table`   | Data Table         |
| `kanban`       | Kanban Board       |
| `timeline`     | Timeline           |
| `stat-card`    | Stat Card          |

---

## State Schema

The serialised output for a single frame looks like:

```json
{
  "id": "frame-abc123",
  "label": "Default",
  "layout": {
    "layoutTemplate": "dashboard",
    "regions": ["header", "sidebar", "main", "footer"],
    "options": {
      "smartDock": true,
      "mainFlow": "stack"
    }
  },
  "components": [
    {
      "id": "cmp-xyz789",
      "type": "navbar",
      "region": "header",
      "label": "Navigation Bar",
      "props": {}
    }
  ]
}
```

A full project contains multiple pages, each containing multiple frames.

### `layoutTemplate` values

| Value | Description |
|---|---|
| `"full-width"` | Single column, no sidebar, no header chrome |
| `"dashboard"` | Header + left sidebar + main content area |
| `"split"` | Two equal-width panes side by side |
| `"marketing"` | Full-width hero, no persistent navigation |

The layout compiler reads `layoutTemplate` to select which positional template to use, then fills the template's named slots from the `regions` list. Adding new templates only requires changes to the consuming application — the spec JSON stays unchanged.

---

## Extending the Builder

### Add a new built-in component type
Edit `js/data.js` — add an entry to `COMPONENT_TYPES` and optionally a default label in `DEFAULT_LABELS`.

### Add a schematic (canvas preview)
Edit `js/schematics.global.js` — add a `case` for your new type in `renderSchematic()`.

### Add layout patterns
Edit `js/data.js` — add a new entry to the `PATTERNS` array. Each pattern is a preset component list applied to a fresh frame.

### Add custom components at runtime
Use the Component Builder modal (the **+** icon in the library panel). Custom definitions are stored in `window.VSUB.state.customComponents` and persist for the session.

---

## Technical Notes

- **No build step**: plain HTML + CSS + JS, opened directly as a `file://` URL.
- **Classic scripts over ES modules**: ES modules require a same-origin HTTP server. Classic scripts with the `window.VSUB` shared namespace avoid this restriction entirely.
- **No framework**: all rendering is imperative DOM manipulation via `innerHTML` and `document.querySelector`.
- **No external dependencies**: no libraries, no CDN links.
