# Usability testing

Remote, moderated usability studies for a project. Built on the
`usability-testing` branch; **local only, not deployed**.

## What it is

A **study** is one round of testing, and everything about that round lives
under it:

| Sub-section | What it holds |
|---|---|
| Study | What is tested: details, research questions, the protocol and consent form a participant reads, the tasks, the files tasks hand out, the moderator's script and the word-choice list |
| Participants | Who takes part, the test account each uses, and their personal link |
| Observation capture | One capture per participant: the script to read, and per task a stopwatch, error count, outcome and notes |
| Study insights | The study across its participants: observations against participants, the measures with their averages, and the word choices |

There is no separate "test" object. To reuse or adjust a protocol, a consent
form, tasks or a script, **clone** the study: the copy has the content and
files and no participants. **Export** gives the same as one JSON file, which
**Import study** takes back (in this project or another).

Only organisation admins can use it (`data:write`), reads included: a
participant's row holds a test account's password. An agent holding a board
token can write a study's tasks, and nothing else (see below).

## How a round runs

1. Create a study, or clone or import one, and edit its content.
2. Add participants. Each gets a code (P1, P2, …) and a link. **Nothing is
   sent**; copy the link and send it yourself.
3. The participant opens `/study/<token>` with no account. They read the
   protocol and the consent form, type their name and agree. Then they see the
   test account, each task (scenario, notes, files, an answer box where the
   task asks a question, a 1 to 10 ease rating) and the word choice exercise.
4. The moderator opens the participant under Observation capture and runs the
   session from that screen. The participant's rating and answer appear within
   about five seconds.
5. Study insights collects the round. Observations and measures export as CSV.

Recording the session is out of scope: the video call tool does it, and the
default consent form covers it.

## Where things are

| Part | Where |
|---|---|
| Tables | `backend/app/studio/usability/models.py`, migration `c3e8a5f1d620` |
| Content rules (what a participant may see, the averages, the defaults) | `backend/app/studio/usability/content.py` |
| Content schema | `StudyContent` in `backend/app/studio/usability/schemas.py` |
| Routes | `backend/app/studio/usability/routes.py` |
| Routes an agent reaches | `backend/app/studio/usability/agent_routes.py` |
| MCP tools | "Usability studies" section of `board_mcp.py` |
| Organisation's screens | `frontend/app/web/src/features/project/usability/` (`UsabilityPage`, `StudyPage` and its four sections) |
| Participant page | `ParticipantPage.tsx` in the same folder, route `/study/:token` |
| Tests | `backend/tests/test_usability.py`, `usabilityModel.test.ts` |

## Rules that are easy to get wrong

1. **A study hangs off the project lineage, not a project row** — like the
   board. A project row is one frozen design version; a round of testing is
   live. So the tables have no `project_id` (versioning neither copies nor
   skips them) and the write routes are exempt from the project lock
   (`tests/test_lock_coverage.py`).
2. **The participant page has no session.** It finds its row by token with a
   cross-account read, then adopts that row's organisation (`_session` in
   `routes.py`), so row-level security confines everything after. Both
   settings are transaction-local: a participant route does all its work
   before its one commit.
3. **Nothing past the consent form is returned before consent**, and every
   participant route except reading the form and consenting returns 403 until
   it is given.
4. **A participant never receives the moderator's half of a task**
   (`success`, `path`, `watch`, `probes`). `content.participant_content` is
   the one place that decides.
5. **Only files a task lists are served to a participant.** A file added to
   the study but ticked on no task stays private.
6. **Tasks are keyed by id, not position.** Reordering or renaming a task
   keeps what was captured for it; removing one hides its results.
7. **Changing the consent wording raises `consent_version`**; each
   participant keeps the version they agreed to.
8. **The link token and the test account password are stored readable.** An
   admin copies the link at any time, and the password is shown to the
   participant. Use test accounts only.
9. **Success is scored the spreadsheet's way:** 1 for finishing unaided, 0
   for with help or fail.
10. **A closed study's links stop working** (410). An unknown link is 404.

## Files

Study files (a dataset, a definition) are kept in the database, up to 2 MB
each, not in the documents bucket: they are small, a study must clone and
export whole, and a participant has no session to presign a download for.
They are always served as a download, never rendered.

## Writing tasks from a repository (the MCP server)

An agent connected through `board_mcp.py` can write a study's tasks from what
a project's product really does. Ask it, in the product's repository, to
"write usability study tasks for …"; it reads the code, then uses:

| Tool | What it does |
|---|---|
| `study_task_guide` | How to write tasks: the fields, which half the participant sees, what makes a good set. Read first |
| `list_studies`, `get_study` | What exists: details, research questions, tasks, file names |
| `create_study` | A new study with the default protocol, consent form and script, and no tasks |
| `add_study_file` | Upload a file a task hands out (at most 2 MB) |
| `add_study_tasks` | Append tasks in order. All or nothing, with the precise errors |
| `update_study_task` | Correct one task by id |

These call their own routes (`backend/app/studio/usability/agent_routes.py`,
under `…/usability/agent/…`), not the editor's:

- **Nothing about a participant is returned or changed.** The editor's routes
  stay closed to a board token because they return each participant's link
  and test account password.
- **An agent adds and corrects; it does not delete or replace.** Removing or
  reordering tasks, and deleting a study, stay with a person.
- **The protocol, consent form and script stay with a person.**
- **A closed study refuses changes.**
- A task may only list a file the study holds.

A board token is confined to the project it was minted for, and only an
organisation admin can mint one. If the editor is open on the same study while
an agent writes to it, reload the page before editing: the editor saves the
whole content and would otherwise put back what it loaded.

The guide's text is `TASK_GUIDE` in `content.py`. The reachable routes are
listed, with the reason, in `tests/test_board_token_routes.py`.

## Not built

- Raising an observation as a board requirement or feedback item.
- MCP tools that read a study's results (participants, captures, insights).
- Choosing the application address from the project's environments (it is a
  plain field on the study, copied to each new participant).
- Sending links, recording, and the final report.
