// Public landing page: what Ferrous Studio does and why it is worth using.
// Marketing content only; every call to action goes to sign-in. Prerendered
// to static HTML at build time (see scripts/prerender.mjs) so crawlers see
// the copy without running JavaScript.
//
// Describe built capability only. The roadmap strip is the one place that
// mentions what is coming, and says so.
import { Link } from "react-router-dom";

const STEPS = [
  {
    n: "01",
    title: "Lay out the screens",
    body: "Each page starts as one region. Split it horizontally or vertically as far as you need, drag the dividers to size things, and drop components in. No pixels to push; just what goes where.",
  },
  {
    n: "02",
    title: "Configure, don't decorate",
    body: "Every component exposes a small, complete property set: the columns of a table, the fields of a form, the items in a nav. Edit them inline on the canvas.",
  },
  {
    n: "03",
    title: "Build your own vocabulary",
    body: "Compose custom components from primitives and save them to the library, so design and engineering share one name for the same thing.",
  },
  {
    n: "04",
    title: "Export structured intent",
    body: "Copy the whole project as plain JSON. It is the full truth of the spec, ready for an engineer or an LLM to build from.",
  },
];

const FEATURES = [
  {
    title: "Regions, not pixels",
    body: "Pages are trees of regions: split any region in two, resize with the divider or let content set the size. The layout compiler on the other side decides how that becomes a DOM.",
  },
  {
    title: "Real components, your words",
    body: "Components render as the UI they stand for — nav bars, tables, forms, dialogs — and every piece of text on the screen is yours to edit in place. Enough to reason about a screen, never enough to argue about a shade of blue.",
  },
  {
    title: "Component builder",
    body: "Group primitives into rows, columns and grids, multi-select with a marquee, undo and redo, then save the result as a reusable component.",
  },
  {
    title: "Pages that link together",
    body: "Nav items and buttons link to other pages — or to a single region, so only that part of the screen swaps while the shell stays put. Child pages nest like routes, ready for a router.",
  },
  {
    title: "Live JSON inspector",
    body: "The inspector shows the exact data your canvas produces. There is no hidden format and nothing the export knows that you cannot see.",
  },
  {
    title: "No lock-in",
    body: "The output is plain JSON with no proprietary schema. Any tool or language can read it. The spec belongs to the team, not to the tool.",
  },
];

const ROADMAP = [
  "Engineer notes: typed annotations on any component or page, carried in the payload.",
  "Schema linking: one named schema generates a form, a table and a card template.",
  "User types: project-level roles assigned to screens to communicate access intent.",
];

export function LandingPage() {
  return (
    <div className="landing theme-dark">
      <header className="landing-nav">
        <span className="shell-brand landing-brand">
          <span className="brand-symbol small" aria-hidden="true" />
          Ferrous Studio
        </span>
        <span className="shell-spacer" />
        <Link to="/signin" className="btn">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <p className="landing-kicker">Low-fidelity wireframing, built for speed</p>
        <h1>Most design tools produce pictures. This one produces structured intent.</h1>
        <p className="landing-lead">
          Ferrous Studio lets product owners and designers define screen structure, component
          configuration and engineer-facing detail in minutes, then export the result as a structured
          payload an engineer, or an LLM, can build from directly.
        </p>
        <div className="landing-cta">
          <Link to="/signin" className="btn primary">
            Sign in to get started
          </Link>
          <a href="#how" className="btn ghost">
            See how it works
          </a>
        </div>
      </section>

      <section className="landing-problem">
        <div className="landing-col">
          <h2>The problem with pictures</h2>
          <p>
            A Figma frame says what a page looks like. It does not say what the page <em>is</em>: which
            regions exist, what a table needs to show, which fields a form collects. Engineers reverse-engineer
            that from screenshots, and every iteration becomes a game of spot the difference.
          </p>
        </div>
        <div className="landing-col">
          <h2>A spec is a data contract</h2>
          <p>
            When you drag a data table into the main region of a dashboard, you are not choosing a colour.
            You are stating that this page needs a data table here. Ferrous Studio makes that statement
            machine-readable from the moment it is made, so the JSON diff between two versions is a precise
            change log.
          </p>
        </div>
      </section>

      <section className="landing-steps" id="how">
        <h2>How it works</h2>
        <ol>
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="landing-step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-features">
        <h2>What you get</h2>
        <div className="landing-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="card">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-roadmap">
        <h2>On the roadmap</h2>
        <p className="muted">Specified, not yet shipped. Listed so you know where this is heading.</p>
        <ul>
          {ROADMAP.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <footer className="landing-footer">
        <span>Ferrous Studio · Ferrous Labs</span>
        <Link to="/signin">Sign in</Link>
      </footer>
    </div>
  );
}
