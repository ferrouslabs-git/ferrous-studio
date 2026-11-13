# Wireframe export → prototype

`get_design_brief` returns the wireframe as `wireframe`, in Studio's export
shape. This file maps each part of that shape onto the template. The
vocabulary of component and element types is in `catalogueReference` in the
same response; `.claude/skills/reverse-engineer-repo/references/catalogue.md`
describes what each component is *for*.

## The shape

```json
{
  "wireframeName": "Management app",
  "interfaceType": "desktop",
  "landingPageId": "<page id>",
  "datasets": [{ "id": "<id>", "name": "Order status", "kind": "status", "values": ["New", "Packed"] }],
  "customComponents": [],
  "pages": [
    {
      "id": "<page id>",
      "name": "Orders",
      "route": "/orders",
      "placement": { "page_id": "<shell page id>", "region_id": "<region id>" },
      "presentation": "drawer",
      "layout": {
        "kind": "split", "id": "s1", "dir": "row", "size": { "fr": 1 },
        "children": [
          { "kind": "region", "id": "r-nav", "label": "Nav", "size": 220, "components": [] },
          { "kind": "region", "id": "r-main", "label": "Content", "size": { "fr": 1 }, "dir": "col",
            "components": [
              { "id": "c1", "type": "list", "shape": "table", "layout": "vertical", "label": "Orders",
                "elements": [
                  { "id": "e1", "type": "column", "label": "Status", "data": { "kind": "status", "dataset": "<dataset id>" } },
                  { "id": "e2", "type": "row-action", "label": "Edit" }
                ],
                "props": { "links": { "el:e2": { "pageId": "<page id>" } } } }
            ] }
        ]
      }
    }
  ]
}
```

`placement` and `presentation` are absent on an ordinary page. Arrays are
already in display order.

## Pages → `src/pages.ts`

One `PageEntry` per wireframe page, with `id` set to the wireframe's page id
so links resolve by lookup.

| Wireframe page | `PageEntry` |
|---|---|
| `id` | `id`, unchanged |
| `name` | `title`; also names the component file (`OrdersPage.tsx`) |
| `route` | `path`. Null or duplicate: derive a slug from the name. A placed page's path is relative to its parent's (`"orders"`, or `""` for the one shown by default) |
| `placement.page_id` | `parentId` |
| `presentation` | `presentation` (`modal`, `drawer`, `drawer-left`) |
| `landingPageId` (wireframe) | `LANDING_PAGE_ID`. Null: the first page a nav item of the shell links to |

`App.tsx` builds the routes from the registry; do not edit it to add pages.

## Layout tree → layout

`layout` is a tree of two node kinds.

| Node | Becomes |
|---|---|
| `split` with `dir: "row"` | A flex row; each child is a column |
| `split` with `dir: "col"` | A flex column; each child is a row |
| `region` | A container holding that region's components |
| `region.dir` | `col` or absent: components stack. `row`: side by side, scrolling sideways if they overflow. `free`: each component is positioned at its `props.x` / `props.y` |
| `region.bg` | The region's background, unless the brief's palette replaces it |
| `region.label` | What the region is (`Nav`, `Header`, `Content`). Not shown |

`size` along the parent split's axis:

| `size` | CSS |
|---|---|
| a number | that many pixels, fixed (`flex: 0 0 220px`) |
| `"auto"` | hug content (`flex: 0 0 auto`) |
| `{ "fr": n }` | share the remaining space by weight (`flex: n 1 0`) |

Keep the proportions and the order. The brief restyles the layout; it does
not rearrange it. On `interfaceType: "mobile"` (390×844), `tablet`
(768×1024) and `tablet_landscape` (1024×768), design for that viewport;
`desktop` must hold from about 960 px wide upwards.

## Placement → nested outlets

A page with `placement: { page_id, region_id }` renders **inside that
region of its parent page**.

- The parent's component renders `<Outlet />` exactly where region
  `region_id` is in its layout.
- The child's `PageEntry` gets `parentId: page_id`.
- Placement nests: a placed page can itself be the parent of others.
- The usual case is a shell: a split with a `Nav` region holding a `navbar`
  and a `Content` region that other pages are placed into. See
  `template/src/pages/ShellPage.tsx`.

A page with a `presentation` never hosts placed pages.

## Presentation → overlays

A page with `presentation` opens **over** the page it was linked from.

| `presentation` | Overlay |
|---|---|
| `modal` | centred dialog |
| `drawer` | panel from the right edge |
| `drawer-left` | panel from the left edge |

Write the page's component as content only. `lib/Overlay.tsx` supplies the
chrome, the scrim, Escape and the close button; `useGo` opens it over the
current page. See `template/src/pages/OrderDrawer.tsx`.

## Links → routes

A component's `props.links` maps an element to where it goes:

```json
"props": { "links": { "el:<elementId>": { "pageId": "<page id>", "regionId": "<region id>" } } }
```

- The key is `el:` followed by the element's `id`.
- The value is a `LinkTarget`, or an array of them (an element with several
  destinations, such as a row menu: one entry per choice, in order).
- `pageId` `"@back"` means: return to the previous page. A form's Cancel and
  Save usually carry it.
- `regionId`, when present, means the link shows only that region of the
  target page. Navigate to the page and bring that region into view.

In code, every one of these is `go(pageId, regionId)` from `useGo()`
(`lib/nav.tsx`), or `go(BACK)`. Use `<NavLink to={pathOf(pageId)}>` for nav
items so the current one is marked.

Every link in the wireframe works in the prototype. An element with no link
is still rendered and still looks interactive if its type is, but goes
nowhere: do not invent destinations.

## Components → real UI

Build each as real, working UI in the brief's visual language, not a drawing
of a wireframe box.

| `type` | Build | Notes |
|---|---|---|
| `navbar` | Top bar (`layout: horizontal`) or side rail (`vertical`) | `shape`: `plain`, `tabs`, `icons`, `breadcrumb`, `grouped` (section headings above groups of links) |
| `list` | `table` → a table; `cards` → a card grid; `rows` → a settings-style list; `feed` → an activity feed | One row per sample record; `column` elements are the fields |
| `form` | Labelled fields and buttons | `shape`: `simple`, `sections`, `wizard` (one `step` per stage, with working next/back), `inline`. `layout`: `one-column`, `two-column`, `horizontal`. A field's `data.span` sets how much of the row it takes |
| `graph` | A chart drawn with inline SVG | `shape`: `bar`, `line`, `area`, `pie`, `donut`, `scatter`; `stats` → KPI tiles, one per `stat`. No chart library is needed for sample data |
| `calendar` | `month`, `week`, `day`, `schedule` or `mini` view | `event` elements are the entries |
| `canvas` | Free composition of its elements | `layout: fixed` or `float` positions elements by `data.x` / `data.y` / `data.w` / `data.h`; treat those as intent and lay out responsively |

`customComponents` (project-level) are compositions of the same vocabulary;
a component with a `customId` is an instance of one.

## Elements → controls

An element's `type` is its shape; `label` is its visible text; `data` holds
its settings. The full list per component is in `catalogueReference`.

| Element | Control |
|---|---|
| `heading`, `text`, `label`, `help-text`, `section-heading` | Text at the matching level |
| `text-input` | `<input>`; `data.kind` (`text`, `email`, `number`, `password`, `phone`, `url`) sets its type |
| `text-area` | `<textarea>` |
| `select`, `multi-select`, `radio-group` | The control, with options from the dataset or `data.samples` |
| `checkbox`, `toggle`, `slider`, `date-picker`, `date-time`, `file-upload` | The matching control, working |
| `button`, `link`, `row-action`, `nav-item` | A button or link; `data.variant` (`square`, `rounded`, `pill`) and `data.fill` (`filled`, `outline`, `ghost`) are intent the brief may restyle |
| `column` | A table column; `data.kind` (`text`, `number`, `date`, `currency`, `status`, `person`, `tags`, `boolean`, `actions`, …) decides how a cell is drawn |
| `search`, `filter`, `pagination` | Working over the sample rows |
| `badge`, `divider`, `box`, `image`, `icon`, `avatar`, `brand` | As named; `data.icon` names an icon |
| `stat`, `series`, `category-axis`, `value-axis`, `legend` | Parts of a `graph` |

Controls work: inputs accept typing, selects open, toggles toggle, tabs
switch, a wizard advances. State lives in memory and resets on reload.
Nothing is saved or sent anywhere.

## Datasets → sample data

- An element with `data.dataset` set to a dataset's `id` takes that
  dataset's `values`, in order (a status column's statuses, a select's
  options).
- An element with `data.samples` carries its own values.
- Put the values in `src/data.ts` and build records around them. Use the
  wireframe's values exactly; invent only what it leaves open (the other
  columns of a row), and invent plausible, obviously fictional data.
- Never fetch data. Never use real people's details.

## Reference images

Take palette, type, spacing, shape and mood from them, as the brief's text
directs. They are not content: do not place them in the prototype unless
the brief says to. An image the prototype does use is imported from `src/`
so the build inlines it.

## Before submitting

- Every wireframe page has a `PageEntry` and renders.
- Every `props.links` entry navigates to its target; `@back` goes back.
- Every `presentation` page opens as its overlay and closes.
- Every `placement` page renders inside its parent's region.
- Dataset values appear where the wireframe binds them.
- `npm run build` and `scripts/check_build.mjs` pass.
