// Public landing page: what Ferrous Studio does and why it is worth using.
// Marketing content only. Prerendered to static HTML at build time (see
// scripts/prerender.mjs) so crawlers see the copy without running JavaScript;
// keep it free of state, effects and anything that renders differently on the
// client, or hydration will mismatch.
//
// Layout and copy follow brand-guidelines.html (repo root): mono eyebrow
// labels, one gradient phrase per page, numbered sections, candid about
// limits. The structure borrows what the category's product pages have in
// common (a real product visual in the hero, feature rows that alternate
// copy and picture, a "who it is for" section and a closing call to action)
// without their fabricated social proof.
//
// Describe built capability only. The roadmap strip is the one place that
// mentions what is coming, and says so. The product is invite-only, so both
// calls to action are "Sign in" and "Request access"; there is no sign-up.
import { Link } from "react-router-dom";
import { ConfigureArt, ENVELOPE_JSON, ExportArt, HeroArt, Json, LinkArt, SplitArt } from "./LandingArt";

const REQUEST_ACCESS = "mailto:hello@ferrouslabs.co.uk?subject=Ferrous%20Studio%20access";

const PROBLEMS = [
  {
    n: "01",
    title: "The structure lives in someone's head",
    body: "Which regions a page has, what the table shows, which fields the form collects: none of it is in the frame. Engineers reverse-engineer it from screenshots.",
  },
  {
    n: "02",
    title: "Every iteration is spot the difference",
    body: "Two versions of a picture cannot be diffed. The change log is whatever someone remembered to write down.",
  },
  {
    n: "03",
    title: "Handing a picture to a model is worse",
    body: "Given a screenshot, an LLM guesses at intent and fills the gaps with defaults. Given the structure, it has nothing to guess.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Split the page into regions",
    body: "Each page starts as one region. Split it horizontally or vertically as far as you need, drag the dividers to size them, or let the content decide. Nothing sits at a coordinate unless you ask it to.",
    art: <SplitArt />,
  },
  {
    n: "02",
    title: "Drop in components and say what they hold",
    body: "Six components cover most product screens: nav bar, list, form, graph, calendar and a free canvas. Each is built from typed elements, so a column knows its data kind and a nav item knows where it goes. Every label on the canvas edits in place.",
    art: <ConfigureArt />,
  },
  {
    n: "03",
    title: "Link pages the way a router would",
    body: "Nav items and buttons link to a page, or to one region of it, so only that part swaps while the shell stays put. Child pages nest like routes and a page can open as a modal or a drawer. Preview mode clicks through the lot.",
    art: <LinkArt />,
  },
  {
    n: "04",
    title: "Export the whole brief as JSON",
    body: "Personas, use cases, diagrams, datasets and every wireframe leave as one envelope. There is no proprietary format and nothing the export knows that you cannot already see on screen.",
    art: <ExportArt />,
  },
];

const FEATURES = [
  {
    title: "Real components, your words",
    body: "Components render as the UI they stand for, and every string on the screen is yours to edit. Enough to reason about a screen, never enough to argue about a shade of blue.",
  },
  {
    title: "Personas and use cases",
    body: "Record who each screen is for. Actors from the use case diagram link to wireframes and travel in the export as user types.",
  },
  {
    title: "Datasets",
    body: "Define a list of values once, then bind it to any column, dropdown or filter. Change it in one place and every screen follows.",
  },
  {
    title: "Snapshots",
    body: "Save a version whenever a decision is made. Preview any earlier one, restore it, or fork it into a new wireframe.",
  },
  {
    title: "Notes, tasks and an audit log",
    body: "Annotate any region, component or element for the engineer who builds it. Every change is recorded with who made it and when.",
  },
  {
    title: "Diagrams and documents",
    body: "Draw UML in the built-in editor and keep reference files with the project, so the export carries the reasoning as well as the screens.",
  },
];

const AUDIENCE = [
  {
    title: "Product owners",
    body: "Lay out the screens in a working session and leave with a spec, not a to-do to write one. The export goes straight into the ticket.",
  },
  {
    title: "Designers",
    body: "Settle structure before style. Decide what each page holds and how it links, then take the visual decisions into your own tools.",
  },
  {
    title: "Engineers and models",
    body: "Read one JSON tree: splits become rows and columns, regions become containers, child pages become nested routes. Build from it, or have an LLM do the first pass.",
  },
];

const ROADMAP = ["Schema linking: one named schema generates a form, a table and a card template."];

export function LandingPage() {
  return (
    <div className="landing theme-dark">
      <header className="landing-nav">
        <Link to="/" className="landing-brand">
          <span className="brand-symbol small" aria-hidden="true" />
          Ferrous Studio
        </Link>
        <nav className="landing-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">What you get</a>
          <a href="#export">The export</a>
        </nav>
        <span className="shell-spacer" />
        <Link to="/signin" className="btn">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-wrap">
          <p className="landing-eyebrow">Low-fidelity wireframing from Ferrous Labs</p>
          <h1>
            Most tools produce pictures.
            <br />
            This one produces
            <br />
            <span className="gradient-text">structured intent</span>.
          </h1>
          <p className="landing-lead">
            Ferrous Studio is where product owners and designers lay out screens, configure the components on
            them and record who each screen is for. The result exports as one JSON payload an engineer, or an LLM,
            builds from directly.
          </p>
          <div className="landing-cta">
            <Link to="/signin" className="btn primary">
              Sign in
            </Link>
            <a href={REQUEST_ACCESS} className="btn ghost">
              Request access
            </a>
          </div>
          <p className="landing-caption">Invite-only. Organisations are set up by Ferrous Labs.</p>
        </div>
        <div className="landing-wrap wide">
          <HeroArt />
        </div>
      </section>

      <hr className="landing-molten" />

      <section className="landing-problem">
        <div className="landing-wrap">
          <p className="landing-eyebrow">The problem</p>
          <h2>
            A picture says what a page looks like.
            <br />
            Not what it is.
          </h2>
          <div className="landing-grid three">
            {PROBLEMS.map((p) => (
              <article key={p.n} className="card landing-card">
                <span className="landing-n">{p.n}</span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-steps" id="how">
        <div className="landing-wrap">
          <p className="landing-eyebrow">How it works</p>
          <h2>Four moves. No pixels.</h2>
          <ol>
            {STEPS.map((s) => (
              <li key={s.n} className="landing-step">
                <div className="landing-step-copy">
                  <span className="landing-n">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
                <div className="landing-step-art">{s.art}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="landing-features" id="features">
        <div className="landing-wrap">
          <p className="landing-eyebrow">What you get</p>
          <h2>The essentials of a spec, done properly.</h2>
          <div className="landing-grid three">
            {FEATURES.map((f) => (
              <article key={f.title} className="card landing-card">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-export" id="export">
        <div className="landing-wrap">
          <div className="landing-export-grid">
            <div className="landing-export-copy">
              <p className="landing-eyebrow">The export</p>
              <h2>Everything a builder needs, in one envelope.</h2>
              <p>
                Copy it into a ticket, commit it beside the code, or paste it into a model's context. The diff
                between two exports is the change log.
              </p>
              <p>
                It is plain JSON with no proprietary schema. Any language reads it, and the spec belongs to the
                team, not to the tool.
              </p>
              <h3>Where it stops</h3>
              <p>
                Ferrous Studio does not do visual design. Colour, type and spacing are decisions for Figma or
                for the code, taken once the structure is agreed.
              </p>
            </div>
            <Json src={ENVELOPE_JSON} className="envelope-json" />
          </div>
        </div>
      </section>

      <section className="landing-audience">
        <div className="landing-wrap">
          <p className="landing-eyebrow">Who it is for</p>
          <h2>Three seats at the same spec.</h2>
          <div className="landing-grid three">
            {AUDIENCE.map((a) => (
              <article key={a.title} className="card landing-card">
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-roadmap">
        <div className="landing-wrap">
          <p className="landing-eyebrow">On the roadmap</p>
          <p className="landing-roadmap-note">Specified, not yet shipped. Listed so you know where this is heading.</p>
          <ul>
            {ROADMAP.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="landing-close">
        <div className="landing-wrap">
          <h2>
            Stop describing screens.
            <br />
            Start specifying them.
          </h2>
          <div className="landing-cta">
            <Link to="/signin" className="btn primary">
              Sign in
            </Link>
            <a href={REQUEST_ACCESS} className="btn ghost">
              Request access
            </a>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-wrap">
          <div className="landing-footer-row">
            <span className="landing-brand">
              <span className="brand-symbol small" aria-hidden="true" />
              Ferrous Studio
            </span>
            <nav className="landing-footer-links" aria-label="Footer">
              <a href="https://ferrouslabs.co.uk">ferrouslabs.co.uk</a>
              <a href="mailto:hello@ferrouslabs.co.uk">hello@ferrouslabs.co.uk</a>
              <Link to="/signin">Sign in</Link>
            </nav>
          </div>
          <p className="landing-legal">
            Entendex Ltd trading as Ferrous Labs · 1 Empire Mews, Streatham, London SW16 2BF · London-based.
            Building globally.
          </p>
        </div>
      </footer>
    </div>
  );
}
