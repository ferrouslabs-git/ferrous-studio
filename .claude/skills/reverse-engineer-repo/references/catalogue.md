# Studio's vocabulary

**There are six components. Nothing else exists.** A "hero", "detail
panel", "footer" or "empty state" you might reach for by habit are all
retired -- the validator rejects them by name. Every screen, however
unusual, is built from these six.

This file is a reference for what each one is *for*; the exact list of
shapes, layouts and elements it accepts lives in
`backend/app/studio/catalog.json` (generated from the frontend, always
current -- read it directly rather than trusting this file's lists to stay
in sync).

## navbar

Navigation: a top bar or a side rail.

- **shapes**: `plain`, `tabs`, `icons`, `breadcrumb`, `grouped`
- **layouts**: `horizontal` (top bar), `vertical` (side rail)
- **elements**: `brand`, `nav-item`, `group-heading`, `search`, `select`,
  `button`, `avatar`, `workspace-switcher`, `divider`

Use it for: the app's primary nav, a sidebar, a top tab strip, a breadcrumb
trail. `shape: grouped` is for a sidebar with section headings above groups
of links.

## list

Anything that shows many rows of the same kind of thing.

- **shapes**: `table`, `cards`, `rows`, `feed`
- **layouts**: `vertical`, `grid`, `horizontal`
- **elements**: `header`, `column`, `column-header`, `row-action`,
  `select-column`, `search`, `filter`, `pagination`

Use it for: a data table, a card grid, a settings list, an activity feed.
`shape: table` + `column` elements is by far the most common mapping from
an existing app's tables and data grids.

## form

Anything that collects input and submits it.

- **shapes**: `simple`, `sections`, `wizard`, `inline`
- **layouts**: `one-column`, `two-column`, `horizontal`
- **elements**: `header`, `text-input`, `text-area`, `select`,
  `radio-group`, `checkbox`, `toggle`, `date-picker`, `file-upload`,
  `section-heading`, `step`, `help-text`, `button`

Use it for: a create/edit form, a settings page, a multi-step wizard
(`shape: wizard` + `step` elements), a login form. The submit and cancel
buttons are `button` elements, last in the list; a cancel button links to
`@back`.

## graph

Charts and summary numbers.

- **shapes**: `bar`, `line`, `area`, `pie`, `donut`, `scatter`, `stats`
- **layouts**: `vertical`, `horizontal`
- **elements**: `header`, `series`, `category-axis`, `value-axis`,
  `legend`, `range-selector`, `stat`

Use it for: any chart library's output (Recharts, Chart.js, ECharts all map
the same way), and for KPI tiles (`shape: stats` + one `stat` element per
tile).

## calendar

Date-oriented views.

- **shapes**: `month`, `week`, `day`, `schedule`, `mini`
- **layouts**: `full`, `compact`
- **elements**: `header`, `event`, `view-switcher`, `calendar-nav`,
  `resource-row`, `calendar-legend`

Use it for: a scheduler, a booking calendar, an events view. Rare in a
typical business app -- most of what looks like it needs a calendar
actually just needs a `list` with `data.kind: "date"` columns.

## canvas

Everything that is not one of the other five.

- **shapes**: `plain`, `card`, `grid`, `transparent`
- **layouts**: `fixed`, `fill`, `float`
- **elements**: every element the other components have, minus the ones
  specific to a chart axis/legend or a nav bar -- `heading`, `text`,
  `label`, `badge`, `image`, `box`, `link`, `divider`, plus the full set of
  form and list elements

Use it for: a hero banner (heading + text + button elements), a detail
panel of labelled values (`label` + `text` pairs, one per field), a
dashboard's free-form layout section, prose, anything that used to be a
"detail" or "hero" component before those were retired. When in doubt and
nothing else fits, it's a canvas.

## Data kinds

A `column` element's `data.kind`, or a `text-input`'s, comes from two
different, similarly-named lists -- mixing them up is the single most
common validation failure:

- **Column kinds** (`data.kind` on a `column`): `text`, `number`, `date`,
  `time`, `email`, `phone`, `currency`, `percentage`, `status`, `person`,
  `tags`, `image`, `boolean`, `url`, `actions`
- **Input kinds** (`data.kind` on a `text-input`): `text`, `email`,
  `number`, `password`, `phone`, `url` -- a smaller list, and it has no
  `status` or `date` (use `select` or `date-picker` instead)

## Presentations

A page that opens as an overlay instead of navigating sets
`"presentation"` to one of: `modal`, `drawer`, `drawer-left`. A page with a
presentation cannot itself host another page's `placement` (an overlay
can't contain a child page).
