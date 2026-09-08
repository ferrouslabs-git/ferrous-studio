# Live session — plan of record

Dial the Studio into a discovery call and have it build the declared artefact
(use cases, a diagram, or a wireframe) while the conversation happens, within
a few seconds of speech, with the result appearing in the ordinary Studio UI.

Status: **plan of record, not started.** Drafted 2026-09-08 after an
interview; the decisions in §1 are the user's, the findings in §2 were
checked online and in the codebase the same day, and the four follow-up
decisions were confirmed the same afternoon.

---

## 1. Decisions from the interview

| Question | Decision |
|---|---|
| Who is it for | Elliott's own discovery calls first; built so organisations can switch it on for themselves later. Per-organisation credentials from day one. |
| Audio source | A Google Meet call. Must hear the **customer**, not just the local mic. A participant "bot" is not required if there is another way. |
| Latency | **2–3 seconds** from speech to canvas, not 20–30. Continuous, not cue-driven. |
| Write discipline | Writes **straight into the live artefact**. No proposal/accept layer. |
| Target | **One target per session**, declared up front (UI, or a spoken/typed command). Switching = a new session. |
| Diagram layout | Open — see §2.5. |
| Live view | **SSE**, not polling. |
| Transcription vendor | Cheapest that meets the latency goal; an AWS service is fine but not required. |
| Transcript retention | Kept, as a project document. Consent is handled contractually outside the tool. |
| Model billing | Wanted a Claude **subscription**, not an API key. Not possible (§2.1); **per-organisation API key accepted.** |
| Capture scope | **Chrome tab capture is v1.** Calls outside a Chrome tab wait for a bot integration (§7). |
| Per-utterance model | **Sonnet 5 first**, measured for quality; Opus 5 stays on the consolidation pass. Swap is one config value. |
| Wireframe target | **Existing or new**, chosen by whoever starts the session. |

## 2. Findings that decide the design

### 2.1 A Claude subscription cannot back this feature

Anthropic's own terms (Claude Code docs, *Legal and compliance*, checked
2026-09-08) are explicit:

> OAuth authentication is intended exclusively for purchasers of Claude Free,
> Pro, Max, Team, and Enterprise subscription plans and is designed to support
> ordinary use of Claude Code and other native Anthropic applications.
> Developers building products or services that interact with Claude's
> capabilities, including those using the Agent SDK, should use API key
> authentication through Claude Console or a supported cloud provider.
> Anthropic does not permit third-party developers to offer Claude.ai login
> into their own applications, or to route requests through Free, Pro, or Max
> plan credentials on behalf of their users.

This has been enforced server-side since March–April 2026. A planned
"Agent SDK credit" carve-out (announced for 2026-06-15) was withdrawn the day
it was due to start; subscription OAuth remains Claude Code / Claude.ai only.

The one permitted subscription path — a user signing into the **unmodified
Claude Code binary** with their own account — does not fit: it is a
multi-second-per-turn coding harness, not a sub-3-second scribe, "ordinary
individual usage" would not describe a server driving it for 45 minutes at a
time, and it cannot be offered to other organisations' users from a hosted
product.

**Decision forced:** per-organisation **API key** (bring-your-own Console
key). This is exactly the case the terms bless — "customers provision and
manage their own API keys … provided the resulting usage is billed to the key
owner". Ferrous's own organisation row holds Elliott's Console key. The LLM
call is behind one small interface so a self-hosted model can be swapped in
later if cost demands it (§7).

### 2.2 No bot needed: capture the Meet tab's audio

Chrome's `getDisplayMedia({ video: true, audio: true })` on a **tab** share
returns the tab's audio track — i.e. every remote participant — without
joining the call as anything. Add `getUserMedia` for the local mic and the
Studio has both sides of the conversation, each on its own stream, which
gives speaker attribution ("customer" vs "you") for free with no diarisation.

Caveats: Chrome/Edge only (Firefox silently drops the audio track); the user
must tick "Share tab audio" in Chrome's picker; a Meet in the native
desktop app or on a phone is not capturable this way. Those cases are what a
later meeting-bot integration (Recall.ai, or Google's own Media API) is for.

Google's **Meet Media API** is not an option: it is developer-preview only and
requires *every participant in the conference* to be enrolled in the preview
programme — a non-starter for customer calls.

### 2.3 Transcription: Deepgram streaming

Checked prices, 2026-09-08, pay-as-you-go per audio minute:

| Vendor | Streaming | Notes |
|---|---|---|
| Deepgram Nova-3 | $0.0048 (promo) / $0.0077 list | sub-300 ms; diarisation +$0.002 (not needed, see §2.2); $200 free credit |
| Deepgram Flux | $0.0065 / $0.0077 | turn-detection model, lowest end-of-speech latency |
| Amazon Transcribe | $0.010 | higher latency; no new vendor |
| AssemblyAI Universal-Streaming | $0.0075 ($0.45/hr) | bills WebSocket open time, including idle |

Two streams for 45 minutes ≈ **£0.55**. Deepgram Flux is the pick: it is
built around end-of-turn detection, which is exactly the trigger the scribe
loop keys on (§3.3). One platform-level Deepgram key in the environment for
now — the cost is not worth a per-organisation credential yet.

### 2.4 There is no realtime transport in the codebase

Zero WebSocket/SSE/`EventSource` in backend or frontend. `usePageDocument`
fetches on navigation and caches; nothing re-polls. The API client sends a
**bearer token in a header** (`core/api.ts`), so browser `EventSource` (no
custom headers) is out; the SSE consumer is a `fetch` + `ReadableStream`
reader, which the existing `authService.getValidToken()` slots into. The ALB
idle timeout is the 60 s default: the stream must send a comment keepalive
every 15 s.

### 2.5 Diagram layout happens in the browser

Diagrams are saved whole: maxGraph XML plus a derived `{nodes, edges}` model,
guarded by an integer version. The XML is produced by
`features/diagrams/graph/serialize.ts` and the UML vocabulary lives in
`umlTypes.ts` / `userObject.ts` (`createUserObject(type, attrs)`), all
TypeScript. `@maxgraph/core` 0.24 ships `HierarchicalLayout`,
`CircleLayout`, `CompactTreeLayout` etc. — none are used yet.

What the literature does (GenAI-DrawIO-Creator, DiagrammerGPT, the
JSON-to-graph FastAPI pattern) is the same split: the model emits **only
entities and relationships**, a deterministic layout engine places them. An
LLM emitting raw maxGraph XML is the fragile path everyone moves away from.

Decision: the scribe emits the nodes/edges model; the server stores it as
`ProjectDiagram.model` with `layout_pending=true` and emits an SSE event; the
**open diagram editor** builds cells via `createUserObject`, runs
`HierarchicalLayout` (use case: actors left, use cases right — a fixed
two-column placement is better than hierarchical there), and saves XML +
model through the existing `PUT` with its version guard. Consequence: the
diagram tab must be open for a diagram session — which it is, because that is
where the user is watching. Porting the serialiser to Python is the fallback
if that constraint ever bites.

### 2.6 What the write paths already give us

- `import_page`/`export_page` in `app/studio/ops.py` are tested inverses; the
  whole-wireframe envelope `GET /projects/{id}/export` returns is a format the
  scribe can emit *and* read back as its own context.
- `apply_batch` conflict detection is per-entity and **inserts are exempt**.
  A scribe that mostly inserts never conflicts with a watching user; one that
  `set`s `root` conflicts with everything. The prompt is shaped accordingly.
- Snapshots (`_snapshot`, restore keeps page ids) are the undo story: one
  before the session starts, one when it ends.
- `board/agents.py` is the model for a non-Cognito actor with a narrow
  `ScopeContext`; the live session does not need a token (the browser owns the
  session), but the "agent" role name and RLS var pattern carry over.
- The project version lock (423 at write call sites) applies: a session
  refuses to start on a locked version.
- `ProjectDocument` + S3 is where the transcript lands at session end.

## 3. Architecture

```
Browser (Studio, Live panel)                 Backend (FastAPI)                     External
────────────────────────────                 ─────────────────                     ────────
Meet tab audio ─┐  AudioWorklet   WS /live/sessions/{id}/audio   ┌─> Deepgram Flux (customer)
mic ────────────┘  PCM16 16 kHz  ───────────────────────────────>│─> Deepgram Flux (you)
                                                                 │      │ end-of-turn segments
                                                                 │      v
                                              live_transcript_segments (append)
                                                                 │      │
                                                                 │      v
                                                      Scribe loop (per session task)
                                                        Anthropic Messages API, org key
                                                        cached prefix + tool call
                                                                 │      │ ops / model / rows
                                                                 │      v
                                                      Applier  ─> apply_batch / diagrams.model / use_cases
                                                                 │      │
SSE  <──────────────────────────────────────── GET /projects/{id}/live/events
  transcript.segment · artefact.changed · session.state · scribe.note
  │
  ├─ Transcript panel (right rail)
  ├─ Wireframe canvas: refetch changed page via usePageDocument.cache (write-through)
  ├─ Diagram editor: build cells + HierarchicalLayout + PUT (renderer, §2.5)
  └─ Use cases tab: refetch list
```

### 3.1 Backend module: `app/studio/live/`

- `models.py` — `LiveSession` (id, project_id, account_id, target_kind
  `usecase|diagram|wireframe`, target_id, status `starting|running|ended|failed`,
  started_by, started_at, ended_at, transcript_document_id, usage counters:
  audio_seconds, input_tokens, cached_tokens, output_tokens),
  `LiveTranscriptSegment` (session_id, seq, speaker `customer|you`, text,
  t_start_ms, t_end_ms). Both carry `account_id`, RLS enabled and forced,
  same shape as every other studio table.
- `routes.py` — `POST /projects/{id}/live/sessions` (declare target, snapshot,
  refuse on 423), `POST …/end`, `GET …/sessions`, `GET
  /projects/{id}/live/events` (SSE), `WS /live/sessions/{sid}/audio`.
- `transcribe.py` — one Deepgram WebSocket per stream, labelled; emits
  end-of-turn segments into the DB and the in-process event bus.
- `scribe.py` — the per-session loop (§3.3).
- `apply.py` — target-specific appliers: wireframe (ops through `apply_batch`
  against the session-owned wireframe), diagram (write `model`,
  `layout_pending`), usecase (`UseCase`/`UseCaseActor` upsert by name).
- `events.py` — in-process pub/sub keyed by project id. Single-container
  ECS today, so in-process is enough; a Redis channel is the upgrade if the
  service ever scales out.
- `credentials.py` — see §4.

### 3.2 Audio path

- Browser: `getDisplayMedia` (tab, audio) + `getUserMedia`; each track through
  an `AudioWorklet` that downsamples to 16 kHz mono PCM16 and posts 100 ms
  frames; one WebSocket carrying `{stream: "customer"|"you", pcm}` binary
  frames. Reconnect with backoff; the session survives a dropped socket.
- Backend: fan each stream into its own Deepgram connection. Flux returns
  turn-final segments; those are the only thing the scribe ever sees.

### 3.3 Scribe loop

One asyncio task per session. Trigger: a new final segment. Debounce: wait up
to 800 ms for the other speaker's overlapping turn to close, then run **one
model turn**:

- **Cached prefix** (stable across the whole session, one `cache_control`
  breakpoint): system prompt for the target kind, the component/element
  catalogue (wireframe) or UML vocabulary (diagram), the project export
  envelope as of session start, and the tool definitions.
- **Rolling context**: the transcript so far and the *current* state of the
  target (re-read from the DB each turn, so the scribe never works from a
  stale copy of what it has already built).
- **Tools** (strict schemas): `apply_wireframe_ops(page_id, ops[])`,
  `set_diagram_model(nodes[], edges[])`, `upsert_use_cases(actors[], use_cases[])`,
  `note(text)` (a short "why I did that" line shown in the panel, also the
  scribe's way of saying "nothing to change yet").
- Model: **`claude-sonnet-5`** for the per-turn call, adaptive thinking,
  `effort: "low"` (latency budget is ~1.5 s of model time), streaming so the
  first `tool_use` block can be applied before the turn finishes. The model
  id is a setting (`LIVE_SCRIBE_MODEL`), so Opus 5 or Haiku 4.5 is a config
  change once phase 2 has measured quality against real transcripts.
- **Consolidation pass** every ~5 minutes of new transcript, or on the
  spoken/typed command "tidy up": same prompt on **`claude-opus-5`** at
  `effort: "high"`, allowed to restructure (rename, merge, re-split regions).
  This is the only pass that may `set` the layout root. Caches are
  model-scoped, so this pass pays a cold prefix each time — acceptable at
  once per five minutes.
- Cost, 45-minute call, ~300 per-turn calls on Sonnet 5 (prefix ~15–20k
  tokens read from cache, ~300 output tokens each) plus ~9 consolidation
  passes on Opus 5 → roughly **$2–3**. All-Opus would be $4–6; Haiku 4.5 for
  the per-turn call under $1.

### 3.4 Appliers

- **Wireframe.** The starter picks **an existing wireframe or a new one**
  in the target picker. Either way a snapshot is taken before the first op
  and another at session end, so Restore is the undo for the whole session.
  On an existing wireframe the scribe reads the current pages into its
  prefix and is told which components predate the session; per-turn ops are
  inserts and `set`s on components the scribe itself created, and `set root`
  is reserved for the consolidation pass — which on an existing wireframe
  is additionally told not to remove pre-session components, only to
  reorganise around them. Ops go through `apply_batch` with the page's current
  version, so the server's conflict rule protects the user's concurrent edits
  exactly as it does for a second human. After each batch: `artefact.changed
  {kind: "wireframe", page_id, version}` on the bus.
- **Diagram.** Write `model`, set `layout_pending`, emit
  `artefact.changed {kind: "diagram", id}`. The open editor renders and saves
  (§2.5); if no editor is open the model still persists and renders on next
  open.
- **Use cases.** Upsert `UseCaseActor` and `UseCase` by name (case-folded);
  `actor_ids` resolved by name. Emit `artefact.changed {kind: "usecases"}`.

### 3.5 Frontend

- `features/project/live/` — `LiveSessionPanel` in the right rail of the
  project layout: target picker, Start (runs the two capture prompts), a
  running transcript with speaker labels, the scribe's notes, End. One
  `useLiveEvents(projectId)` hook owns the SSE stream and dispatches by event
  type. Consent is not the tool's job (§1), so no recording banner beyond
  Chrome's own "sharing this tab" chrome.
- Studio canvas: on `artefact.changed` for the open wireframe, refetch that
  page through the existing `PageFetcher` and write through
  `usePageDocument.cache` — no new state model. Edits stay gated on
  `pageSettled` as they already are.
- Diagram editor: on `artefact.changed` for the open diagram with
  `layout_pending`, diff the incoming model against the graph (by node id),
  add/update/remove cells, run the layout for the diagram kind, save. New in
  `graph/applyModel.ts` + `graph/layout.ts`.
- Use cases tab: refetch.

## 4. Per-organisation credentials

New table `account_credentials` (account_id, provider `anthropic`, ciphertext
BYTEA, key_hint last-4, created_by, created_at, rotated_at). The key is
encrypted with **AWS KMS** envelope encryption (`kms:GenerateDataKey` /
`kms:Decrypt` on a per-environment CMK owned in `infra/terraform/`), never
logged, decrypted only inside `credentials.py` for the duration of a session.
No KMS locally: a Fernet key from the environment behind the same interface.
This is the credential-storage piece phase 5 of `go-live-and-merge-boards.md`
deferred; building it here unblocks that too.

UI: the organisation page, under the same `integrations:manage` gate the
GitHub connection is moving to (`docs/github-repository.md`): "Anthropic API
key — paste, we store it encrypted, last four shown". Platform admins never
see organisation keys.

Permissions: new `live:run` (starts/ends sessions; requires `data:write` on
the project too) in `auth_config.yaml`, granted to `account_admin` and
`editor`-equivalent roles, not to members/viewers.

## 5. Phases

| # | Scope | Verifiable by | Size |
|---|---|---|---|
| 0 | Credentials: table + migration, KMS/Fernet interface, org page UI, `live:run` permission | Paste a key, see last-4, backend can decrypt it | 1–2 days |
| 1 | Audio + transcript + SSE, **no LLM**: capture, WS ingest, Deepgram, segments, event bus, panel with live transcript | Run a Meet with a second device; both sides transcribed with the right labels within ~1 s | 2–3 days |
| 2 | Scribe + **use cases** target (flat rows, cheapest to get right) | Talk through a flow; actors and use cases appear in the tab as you speak | 1–2 days |
| 3 | **Wireframe** target: new-or-existing picker, snapshots, ops applier, canvas refetch, consolidation pass | Describe a screen; regions and components appear within ~3 s on both a fresh and a populated wireframe; Restore undoes the session | 3–4 days |
| 4 | **Diagram** target: model applier, browser renderer, layouts per kind | Use case diagram draws itself with actors left / use cases right; class diagram lays out hierarchically | 2–3 days |
| 5 | In-call commands ("tidy up", "new page", "stop"), cost meter on the panel, transcript → S3 document at end | — | 1–2 days |

Phase 1 is deliberately LLM-free so latency, capture and attribution are
proven before a model is in the loop.

## 6. Risks

- **Latency budget.** Deepgram end-of-turn (~300 ms) + debounce (≤800 ms) +
  model first-tool-block (~1–1.5 s) + apply + SSE + refetch. Achievable at
  2–3 s only with a streamed, cache-warm, low-effort turn; a cold cache or a
  long transcript pushes it out. Measure in phase 2 before phase 3.
- **Scribe over-writing.** Sharpest on an existing wireframe. Mitigated by
  inserts-first prompting, the pre-session component list in the prompt, and
  snapshots — but a bad consolidation pass will still be visible for the
  seconds until Restore.
- **Sonnet 5 quality on the per-turn call.** Unknown until phase 2; the
  measure is "did it put the right thing in the right region without a
  consolidation pass fixing it". If it needs Opus, the cost estimate doubles
  and the latency budget tightens.
- **Chrome-only capture.** Accepted for phase 1; the bot integration is the
  fix, not a workaround in the browser.
- **Single-container event bus.** Fine today; must move to Redis before the
  API service scales horizontally.
- **Prompt-cache invalidation.** The project envelope in the cached prefix
  must be frozen at session start; anything volatile goes after the
  breakpoint. Verify `cache_read_input_tokens` > 0 from turn two.

## 7. Later

- Recall.ai (or Meet Media API if it leaves preview) for calls not in a
  Chrome tab.
- Per-organisation Deepgram credential, once anyone other than Ferrous runs
  sessions in volume.
- A self-hosted STT/LLM behind the same `transcribe.py` / `scribe.py`
  interfaces if the per-call cost matters at scale.
- Switching target mid-session without ending it.
- Promote transcript segments to board feedback / requirements.
