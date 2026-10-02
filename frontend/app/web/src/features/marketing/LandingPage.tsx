// Public landing page: what Ferrous Studio does for a Ferrous Labs client.
// Marketing content only. Prerendered to static HTML at build time (see
// scripts/prerender.mjs) so crawlers see the copy without running JavaScript;
// keep it free of state, effects and anything that renders differently on the
// client, or hydration will mismatch.
//
// Audience: the people who commission a build from Ferrous Labs, not the
// people who draw wireframes. Every section leads with what the client gets
// from the workspace (a spec they can read, sign-off that holds, a roadmap
// they can open, somewhere to test and report, code in their own repository)
// and names the product feature second.
//
// Layout and copy follow brand-guidelines.html (repo root): mono eyebrow
// labels, one gradient phrase per page, numbered sections, short declarative
// sentences, candid about limits. The structure borrows what the category's
// product pages have in common (a real product visual in the hero, feature
// rows that alternate copy and picture, a "who it is for" section and a
// closing call to action) without their fabricated social proof.
//
// Describe built capability only; nothing unshipped appears on the page. The
// product is invite-only: an organisation is created as part of an
// engagement, so the calls to action are "Sign in" and "Talk to Ferrous
// Labs"; there is no sign-up.
import { Link } from "react-router-dom";
import { ConfigureArt, DeliveryArt, ENVELOPE_JSON, HeroArt, Json, LinkArt, SplitArt } from "./LandingArt";

const FERROUS_LABS = "https://www.ferrouslabs.co.uk/";

const PROBLEMS = [
  {
    n: "01",
    title: "The spec is a document",
    body: "Written requirements are ambiguous. “A dashboard of the key metrics” is a different screen to everyone who reads it, and nobody finds out until it has been built.",
  },
  {
    n: "02",
    title: "Progress arrives second-hand",
    body: "A weekly summary tells you what someone chose to report. The board the engineers work from is somewhere you cannot open.",
  },
  {
    n: "03",
    title: "The work belongs to the vendor",
    body: "The spec sits in their tool and the code in their account. Handover is a zip file at the end. Leaving is expensive because everything is theirs.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "We lay the screens out with you",
    body: "Discovery happens on the canvas, not in a requirements document. Each page is split into regions and the components each one holds, so the conversation is about what the system does and who uses it. The record of that conversation is the structure itself.",
    art: <SplitArt />,
  },
  {
    n: "02",
    title: "Every screen says what it holds",
    body: "A list on the canvas knows its columns, a form its fields, a chart its series. The statuses, categories and lists your business runs on are defined once as a dataset and reused on every screen. Change one in one place and the whole spec follows.",
    art: <ConfigureArt />,
  },
  {
    n: "03",
    title: "You click through it before it exists",
    body: "Navigation links pages the way the built system will, and preview mode walks the flows. Pin a note or a task to any screen, region or field and it stays with the spec for whoever builds it.",
    art: <LinkArt />,
  },
  {
    n: "04",
    title: "The build runs on a board you can open",
    body: "Releases, sprints and requirements live in the same project as the spec. Status rolls up from the work itself, not from a report. Every environment the build is deployed to is linked from the project, and what your testers find there is filed with a severity, the page it happened on and a marked-up screenshot.",
    art: <DeliveryArt />,
  },
];

const FEATURES = [
  {
    title: "One project, every artefact",
    body: "Personas, use cases, wireframes, UML diagrams, datasets and reference documents sit in one project. Nothing about your build lives in a folder somewhere else.",
  },
  {
    title: "Sign-off that holds",
    body: "When discovery is agreed, the version is locked. Later work branches into a new version, so the signed-off record never quietly changes underneath you.",
  },
  {
    title: "A roadmap that reports itself",
    body: "Releases, sprints and epics, with the requirements underneath. An epic's status is rolled up from its requirements, so the board says a thing is done because the work is done.",
  },
  {
    title: "Test it where it is deployed",
    body: "UAT, staging, production: each environment is linked from the project. Report what you find with a severity, the page it happened on and a marked-up screenshot, then watch it move from new to done.",
  },
  {
    title: "Your repository, not ours",
    body: "Your organisation connects its own GitHub account once. Each project is linked to a repository you own, so the code lives with you while it is being built, not with us until handover.",
  },
  {
    title: "Bring your own stakeholders",
    body: "Invite your colleagues as admins, members or viewers. A member walks the screens, raises feedback and pins tasks. A viewer sees everything and changes nothing. Nobody waits for us to forward a screenshot.",
  },
];

const AUDIENCE = [
  {
    title: "Whoever owns the budget",
    body: "Open the roadmap and see what is in each release, which sprint is running and what is deployed where. Sign off a version and hold the build to it.",
  },
  {
    title: "Whoever will use it every day",
    body: "Walk the screens in preview before a line of code is written. Test each release in UAT and report what is wrong from the page it happened on.",
  },
  {
    title: "Whoever runs it afterwards",
    body: "The spec exports as plain JSON, the code sits in your repository, and the audit log says who changed what and when. There is nothing to recover at handover.",
  },
];

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
          <a href="#ownership">Ownership</a>
        </nav>
        <span className="shell-spacer" />
        <Link to="/signin" className="btn">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-wrap">
          <p className="landing-eyebrow">The client workspace from Ferrous Labs</p>
          <h1>
            Your build,
            <br />
            agreed before it starts,
            <br />
            <span className="gradient-text">visible until it ships</span>.
          </h1>
          <p className="landing-lead">
            Know exactly what you are getting before we build it. Watch it take shape release by release.
          </p>
          <div className="landing-cta">
            <Link to="/signin" className="btn primary">
              Sign in
            </Link>
            <a href={FERROUS_LABS} className="btn ghost">
              Talk to Ferrous Labs
            </a>
          </div>
          <p className="landing-caption">Invite-only.</p>
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
            Most engagements run on
            <br />
            ambiguous requirements and trust.
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
          <h2>From the first call to the last release.</h2>
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
          <h2>
            The whole engagement,
            <br />
            in one place you can open.
          </h2>
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

      <section className="landing-export" id="ownership">
        <div className="landing-wrap">
          <div className="landing-export-grid">
            <div className="landing-export-copy">
              <p className="landing-eyebrow">Ownership</p>
              <h2>It is yours to keep.</h2>
              <p>
                The whole project exports as one plain JSON file: personas, diagrams, datasets and every wireframe,
                with no proprietary schema. Commit it beside the code, load it into another tool, or hand it to
                whoever comes next.
              </p>
              <p>
                The code is in a repository your organisation owns, and an audit log records who changed what and
                when.
              </p>
              <h3>Where it stops</h3>
              <p>
                Ferrous Studio is not a design tool. Colour, type and spacing are decided in Figma or in the code
                once the structure is agreed. It is not a general ticketing system either. It holds one thing: the
                record of what Ferrous Labs is building for you, and how far it has got.
              </p>
            </div>
            <Json src={ENVELOPE_JSON} className="envelope-json" />
          </div>
        </div>
      </section>

      <section className="landing-audience">
        <div className="landing-wrap">
          <p className="landing-eyebrow">Who it is for</p>
          <h2>Three people on your side of the table.</h2>
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

      <section className="landing-close">
        <div className="landing-wrap">
          <h2>
            Working with Ferrous Labs?
            <br />
            The work is in here.
          </h2>
          <div className="landing-cta">
            <Link to="/signin" className="btn primary">
              Sign in
            </Link>
            <a href={FERROUS_LABS} className="btn ghost">
              Talk to Ferrous Labs
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
