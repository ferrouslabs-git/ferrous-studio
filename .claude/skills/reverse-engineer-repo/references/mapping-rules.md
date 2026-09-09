# Code → Studio mapping rules

The Studio's model was built from the same ideas as a web app's routing, so
most of the mapping is direct.

| In the code | In the Studio |
|---|---|
| A route (`<Route path>`, Next `app/**/page.tsx`, Django `urls.py`, Rails `routes.rb`) | A **page** with `route` set to the path; name from the route's title, heading or component name |
| The layout shell (`<Outlet>`, Next `layout.tsx`, a base template with `{% block content %}`) | A **shell page** whose tree splits into a nav region (fixed width for a side rail, `auto` for a top bar), an optional header region, and a `{fr: 1}` content region. Regions are labelled the way the Studio names them: `Nav`, `Header`, `Content` |
| A nested route rendered inside the shell | A **child page** with `placement: {page_id: shell, region_id: content}` |
| A nested layout inside a nested route | A child page that is itself a shell for its children (the outlet model nests) |
| Sidebar / top nav links | A `navbar` component (`layout: vertical` for a rail) of `nav-item` elements, each with `props.links: [{pageId}]`; `brand` from the logo; `avatar` when there is a user menu; `shape: grouped` when items sit under headings |
| A table (`<table>`, a data grid, TanStack, MUI DataGrid) | `list` with `shape: table`; a `column` per column definition, `label` from the header, `data.kind` from the accessor's type (date → `date`, enum → `status` with a few representative values as `data.samples`, money → `currency`, a user → `person`, an actions cell → `actions`); `row-action` per row button; `search`, `filter` and `pagination` when present |
| A card grid | `list` with `shape: cards`, `layout: grid` |
| A feed / activity list | `list` with `shape: feed` |
| A form (`<form>`, react-hook-form, Formik, a Django `Form`) | `form`; `text-input` per input with `data.kind` from the input type, `select` with a few representative `data.samples` from the enum, `checkbox`, `toggle`, `text-area`, `date-picker`, `file-upload`; `section-heading` per fieldset (`shape: sections`); `step` per wizard step (`shape: wizard`); the submit and cancel `button`s last, with `@back` on cancel |
| A chart (Recharts, Chart.js, ECharts) | `graph` with `shape` from the chart type; a `series` per series, `category-axis` / `value-axis` from the axis config |
| KPI tiles | `graph` with `shape: stats` and a `stat` per tile |
| A calendar or scheduler | `calendar` with the matching shape |
| A modal or drawer that is its own view (a form in a dialog, a detail drawer) | Its own page with `presentation: modal` or `drawer`, linked from the trigger |
| Anything else (a hero, prose, a detail panel of labelled values, a dashboard section) | `canvas` with `heading`, `text`, `label`, `badge`, `image`, `box` and `button` elements; a labelled-values detail becomes `label` + `text` pairs |
| An enum used across several screens | Plain inline sample values (`data.samples`) on every column, dropdown or filter that uses it -- this skill doesn't generate shared datasets, so each screen just carries its own representative values |
| Auth roles | Not generated as their own entity. Still worth noting in `inventory.md`, since it's what tells you which screens exist for which kind of user, and the system-context diagram (`references/diagrams.md`) still draws one `actor` shape per role |
| Mobile-first layout, a React Native or Ionic app | `interfaceType: mobile`; otherwise `desktop` |

## Rules to follow explicitly, not just by example

- **Only the six components exist** (see `catalogue.md`). There is no hero,
  footer, modal or detail component; those are `canvas`, a `navbar`, a page
  presentation, and a `canvas` respectively. `validate.py` says "retired"
  for a reason -- if you see that word, the mapping is wrong, not the
  validator.
- **Prefer fewer, correct pages.** A route that is a redirect, a 404 page
  or an auth callback is not a page. A sign-in page is one page, not one
  per auth provider button.
- **Sample data is representative, not real.** Never copy values from
  fixtures, seeds or tests that look like real people; invent plausible
  samples instead.
- **Do not guess what cannot be seen.** A component behind a feature flag
  or a dynamic import that cannot be resolved is noted in `REPORT.md`, not
  invented.
- **Write the shell page(s) last**, because their nav items link to every
  other page -- check every link resolves before merging.

## Framework notes

Add a section here the first time a framework needs one; this file is
meant to grow with each repository the skill is run against, not stay
static.

### React Router / plain SPA

The `<Outlet>` component's parent `<Route>` is the shell; each of its
`element`/`Component` children in the router config is a nested route.
`useNavigate()`/`<Link to>` targets are what a `nav-item`'s `props.links`
should resolve to.

### Next.js (App Router)

`app/layout.tsx` at any level is a shell page for everything under it.
`app/**/page.tsx` is a page; `app/**/loading.tsx` and `error.tsx` are not
pages. Route groups (`(group)`) don't affect the URL and don't need their
own page.

### Django

`urls.py` gives the routes; the view's template is what the page's layout
comes from. A `ModelForm` maps straightforwardly to a Studio `form`; a
`ListView`'s `context_object_name` table maps to a `list`.
