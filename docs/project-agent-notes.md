# Project Agent — what the client wants (plain-language notes)

This is a simple recap of the Slack discussion with Ali and Elliott about
turning "reverse engineer a repo" into a bigger in-app feature. Written so
anyone can read it without technical background.

## 1. The one-line goal

Right now, reverse-engineering a repo into wireframes is a manual job someone
runs on their own laptop. The client's end goal is: **a chat box built into
Studio itself**, called **"Project Agent"**, where you just type what you
want and it happens — no laptop setup, no separate tools.

## 2. The three-step plan to get there

| Step | What it means | Example |
|---|---|---|
| **1. POC** | Prove it works at all, by hand, on a couple of screens | Run Claude Code manually on your laptop against a real repo, get a couple of working wireframes out the other end |
| **2. Local production version** | Make that process solid and repeatable, still run from a laptop, but properly wired up (real rulebook, real repo connection, real Studio connection) | Exactly what we've already built for the board feature — see §4 below |
| **3. Full in-app version** | Nobody needs a laptop or any setup — it all lives inside Studio itself | Elliott's "Project Agent" chat tab — see §5 below |

**Where we actually are today:** step 1 is done (wireframes/diagrams import
works). Step 2 is proven to work, but for a *different* feature (planning),
not yet for reverse-engineering. Step 3 doesn't exist yet at all.

## 3. What "wireframes and diagrams only" means

The client already confirmed: this feature should only ever create
**wireframes and diagrams** — never actors, use cases, or datasets. This is
already true in the code today — even if someone fed it a file containing
those things, the app would ignore them. Nothing to change here.

## 4. Proof this can actually be built — it already exists for a different feature

We already have a **working example** of "Claude Code talks to Studio
directly," built for a different feature: managing the project's planning
board (epics, features, requirements).

**How it works today, step by step:**

1. Someone opens their project in Studio → **Project details** → clicks
   **"+ New token"** under **Board tokens**.
2. Studio hands them a small file (`.mcp.json`) — a note that says *"here's
   the website address, here's which project, here's a secret key."*
3. They paste that file into their own Claude Code setup, on their own
   computer.
4. Now Claude Code (running on *their* laptop) can read and update that
   one project's epics/requirements directly through the real app — as if a
   person was clicking around in the browser, but done by the AI instead.

**Why this matters:** it proves the hard part (Claude Code safely talking to
Studio, scoped to one project, with a proper access key) already works. We
can reuse the same pattern for wireframes/diagrams — we don't have to invent
it from nothing.

**The one thing missing:** this still requires the person to have Claude
Code installed on their own computer. It is not yet a chat box inside the
browser. That's exactly the gap Elliott's idea closes.

## 5. Elliott's idea: a chatbot built into the app itself — the whole flow, as one story

Elliott's proposal is simple to state: **stop making people install anything
— put a chatbot directly on the project's page in Studio.**

Here is the entire flow, start to finish, using one example organisation —
"Acme Inc" — all the way through:

**Step 1 — Connect the repo to the project** *(already built, works today)*

Acme's admin clicks **Connect GitHub** once, for their whole organisation.
Then, on one specific project — say "Acme Website" — someone picks which
repository belongs to it. Nothing new here; this part already exists.

**Step 2 — Open the project → the chatbot is just sitting there**

Someone at Acme opens the "Acme Website" project in Studio. There's a tab
called **"Project Agent."** They click it. A chatbot window opens right on
the page — nothing to install, no setup screen first.

**Step 3 — They type what they want, and the chatbot does it**

They type: *"Build me wireframes and diagrams from our repo."* The chatbot
reads Acme's connected repo (from Step 1) and builds the wireframes and
diagrams directly inside the project, asking a question in the chat if
something's unclear along the way ("these two screens look similar — use
the same layout for both?"). Same result as the manual process we already
built, except now it happens live, in conversation, instead of someone
running a tool on their own laptop.

**This is also where the "human-in-the-loop" idea from the original plan
lives.** The "approval gate" and "question gate" Ali described aren't a
separate feature — they're just the chatbot pausing to ask you something
mid-conversation, the same way a colleague would.

**Step 4 — Right now: we make this chatbot run on our own platform,
globally, for every organisation**

For the first version, **every organisation's chatbot runs on Ferrous
Studio's own AI account** — one shared account, powering the chatbot for
Acme, and every other client, at the same time (each one's actual
conversation still kept completely private and separate — see §6). Acme
doesn't connect anything. They just open the tab and use it. We are the
ones paying for the AI usage, for everyone, by default.

**Step 5 — Later (optional): an org can connect their own Claude account,
and their chatbot switches to using it**

Later, if Acme wants to pay for their own AI usage instead of us paying for
it, their admin goes to a settings page and either **adds their own API
key**, or **connects their own Claude account**. Once they've done that,
*their* chatbot — same tab, same chat window, nothing looks different to
the person typing — quietly switches to running on Acme's own account
instead of ours. Every other organisation that hasn't connected their own
key keeps using the shared platform account as normal.

**In one sentence: right now, one shared platform account powers every
organisation's chatbot; later, any organisation can optionally connect
their own account, and from that point on, their chatbot runs on it
instead — with nothing else about the experience changing.**

**Bonus:** the same chatbot would handle more than just reverse-engineering
— it could also do the separate planning work (creating epics, features,
requirements) that today only works through the local `.mcp.json` method
above. One chatbot, several jobs, instead of one tool per job.

## 6. Is the chat "global" or "per project"?

Both — but at different levels, like WhatsApp:

- **The Project Agent feature itself** (the code, the chat screen) is
  **global** — one thing, built once, available to every organisation using
  Studio.
- **Each actual conversation** is private and tied to **one project**.
  Opening Project A's Project Agent gives you a chat that only knows about
  Project A. Opening Project B gives you a completely separate chat that
  knows nothing about Project A. They never mix.

**Example:** Company X opens their "Marketing site" project's Project Agent
and asks it to build wireframes. Company Y, in a different organisation,
opens their own "Internal tools" project's Project Agent. These are two
totally separate conversations, with separate memory — Company Y's chat has
no idea Company X's conversation ever happened.

**Not decided yet (worth asking Ali directly):** does a project's chat
*remember* previous conversations when you come back later, or does it
start fresh every time you open the tab? This hasn't been discussed yet.

## 7. What's "global" vs "per organisation" vs "per project" — the full picture

| Thing | Level | Already true today? |
|---|---|---|
| The reverse-engineering / Project Agent feature itself | **Global** — one feature, everyone gets it | N/A (not built as a chat yet) |
| GitHub connection | **Organisation** — one org, one GitHub App connection | ✅ Yes, already built exactly this way |
| A project's linked repository | **Project** — each project picks one repo | ✅ Yes, already built |
| A project's Project Agent conversation | **Project** — one private chat per project | ❌ Not built yet |
| Which AI account/key pays for the usage | **Organisation** (see §8) | ❌ Not built yet |

## 8. Letting a client bring their own AI account (a *later* idea, not now)

Right now, the plan is: every organisation using "Project Agent" runs on
**Ferrous Studio's own** Claude Code subscription — meaning your company
pays for everyone's usage.

Elliott's later-stage idea: let a client organisation **connect their own
Claude account, or paste in their own AI key**, so *their* usage is billed
to *them* instead of you.

**Example:** Company X connects their own Anthropic API key once, as the
organisation's admin. From then on, everyone at Company X uses Project
Agent freely — but the AI usage cost is billed to Company X's own account,
not to Ferrous Studio.

This works the same way GitHub connection already works: **one org admin
connects it once, and everyone else in that organisation just uses it** —
nobody else needs their own separate key or login.

**Important: Elliott explicitly said not to build this now.** His words:
*"No need to do this now though, we can add that when we productise."* This
is a note for later, not a current task.

## 9. The rule for running many chats at once safely

Ali's rule, in plain terms: **one Claude Code account overall is fine, but
every project's conversation must run as its own separate, isolated
session — never shared with another project's conversation.**

**Why:** if two different projects' conversations shared the same memory,
the AI would get confused about which project it's actually working on —
mixing up one client's data with another's.

**Example:** if Company X's and Company Y's Project Agent chats accidentally
shared one session, the AI might suggest wireframes from Company X's repo
while answering Company Y's question. The rule exists specifically to make
sure that never happens.

## 10. Summary — what's proven, what's missing

**Proven and working today:**
- Reverse-engineering a repo into a bundle file (wireframes + diagrams only)
- Importing that file into a project through the Studio UI
- Claude Code connecting live to Studio via MCP, scoped to one project (for
  the planning/board feature)
- Org-level connections with project-level details underneath (GitHub is
  the working example)

**Still missing (the actual ask in this conversation):**
- A chat tab built into Studio itself ("Project Agent"), so nobody needs
  their own laptop/Claude Code install
- That chat handling reverse-engineering *and* planning together, in one
  place
- Running that chat safely for many organisations at once, each fully
  separated
- (Later) letting an organisation bring their own AI account/key instead of
  using Ferrous Studio's shared one
- A decision on whether a project's chat remembers past conversations or
  starts fresh each time
