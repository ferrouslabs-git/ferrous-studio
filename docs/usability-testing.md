# Usability testing

Remote, moderated usability studies for a project. Built on the
`usability-testing` branch; **local only, not deployed**.

## What it is

A **study** is one round of testing, and everything about that round lives
under it:

| Sub-section | What it holds |
|---|---|
| Study | What is tested: details and moderator, research questions, the protocol and consent form a participant reads, the tasks, the files tasks hand out, the moderator's script and the word-choice list |
| Emails | The booking invite and confirmation copy |
| Slots | When participants can book: the time zone, windows of time, and the slots they make |
| Participants | Who takes part, their booking, the test account each uses, and their personal session link |
| Observation capture | One capture per participant: the script to read, and per task a stopwatch, error count, outcome and notes |
| Study insights | The study across its participants: observations against participants, the measures with their averages, and the word choices |

There is no separate "test" object. To reuse or adjust a protocol, a consent
form, tasks or a script, **clone** the study: the copy has the content and
files and no participants. **Export** gives the same as one JSON file, which
**Import study** takes back (in this project or another).

Only organisation admins can use it (`data:write`), reads included: a
participant's row holds a test account's password. An agent holding a board
token can do everything but delete, and never sees a participant's link or
password (see below).

## How a round runs

1. Create a study, or clone or import one, and edit its content. On Study
   choose the **moderator** (a Studio super admin) and the **session length**;
   on Slots add the **times participants can book**; on Emails adjust the copy.
2. Add participants. Each gets a code (P1, P2, …), a session link and a
   booking link. With a **contact email** (their own inbox, not the test
   account), adding them sends the **booking invite**: the thank-you copy and
   a *Choose a time* button. It goes only once the study has a moderator, a
   session length and future times; until then the list says what is
   missing, and *Send booking email* sends it later.
3. They open `/book/<booking token>` and pick a free slot, shown in their own
   time zone. The session goes on the moderator's Google calendar with them
   as a guest and a Meet link (Google sends the invite), and they get the
   **confirmation** email: the copy (what to prepare), the time, the Meet link
   and their booking link, which moves the booking if they need another time.
4. At the start of the call, copy the session link and send it. The
   participant opens `/study/<token>` with no account. They read the
   protocol and the consent form, type their name and agree. Then they see the
   test account to sign in with (**Signing in**) -- the study's test account,
   or a participant's own details where they are set -- or, when the study's
   *Testing includes signing up* is ticked, **Get ready to begin**: the
   address, the email to use and the study's sign-up instructions, with no
   password. Then each task (the task, notes, files, an answer box where the
   task asks a question, a 1 to 10 ease rating) and the word choice exercise.
   A markdown file a task hands out is shown on the page beside the task;
   other files are downloads.
5. The moderator opens the participant under Observation capture and runs the
   session from that screen. The participant's rating and answer appear within
   about five seconds.
6. Study insights collects the round. Observations and measures export as CSV.

## Booking and the moderator's calendar

- **Slots** are each window of bookable time cut into session-long slots,
  less any already started, booked by another participant, or overlapping
  something on the moderator's Google calendar. The calendar is read when the
  booking page loads and again when a slot is booked.
- **Each window is held** on the moderator's calendar as a busy event ("Held
  for usability sessions: …"), so nothing else is booked over it. Holds are
  ignored when the calendar is checked; booked sessions (from any study) are
  not, so one moderator is never double-booked across studies. The Slots tab
  shows each window's hold, and *Hold on calendar* holds any that are not
  (added before the calendar was connected, or whose hold failed). Changing
  the moderator moves the holds; sessions already booked stay put.
- **A booking stands only if its calendar event was made.** If Google refuses,
  nothing is booked and the participant is asked to try again. Removing a
  participant cancels their session (Google tells them).
- Without Google connected, booking still works, with no events, holds or
  calendar check, and the Slots tab says so.

### Connecting Google Calendar (once per environment)

1. In a Google Cloud project, enable the **Google Calendar API** and create a
   **service account** with a JSON key.
2. In Google Workspace Admin, *Security → Access and data control → API
   controls → Manage domain-wide delegation*, add the service account's
   client ID with the scope `https://www.googleapis.com/auth/calendar.events`.
3. Store the key in SSM for each environment:
   `aws ssm put-parameter --name /ferrous-studio/<staging|prod>/GOOGLE_SERVICE_ACCOUNT_JSON --type SecureString --value file://key.json`
4. Deploy. The deploy scripts include the key only where the parameter
   exists, so an environment without it deploys as before, with the calendar
   off. Locally, set `GOOGLE_SERVICE_ACCOUNT_JSON` in `backend/.env.local`.
5. Every moderator must be a user in that Workspace domain: Studio acts as
   them to write to their calendar.

Emails go through SES like the invitations. If SES is still in its sandbox,
it only delivers to verified addresses.

Recording the session is out of scope: the video call tool does it, and the
default consent form covers it.

## Where things are

| Part | Where |
|---|---|
| Tables | `backend/app/studio/usability/models.py`, migrations `c3e8a5f1d620`, `a6d3f9c2e481`, `b8e2d4f6a913` (booking) |
| Booking rules, emails, calendar | `booking_service.py`, `calendar.py`; routes in `booking.py` |
| Booking page | `BookingPage.tsx`, route `/book/:token`; the Emails and Slots sections are `StudyEmails.tsx`, `StudySlots.tsx` |
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
11. **The booking link is not the session link.** The booking email carries
    `booking_token`, which only books a time (`booking.py`, `_booking`); the
    session link is never emailed, because it is sent at the start of the call.
12. **Only a person sends email.** Adding a participant in Studio, or *Send
    booking email*, sends the invite; an agent can record a contact email but
    its routes never send, and it cannot set the email copy, the moderator or
    the bookable times.

## Files

Study files (a dataset, a definition) are kept in the database, up to 2 MB
each, not in the documents bucket: they are small, a study must clone and
export whole, and a participant has no session to presign a download for.
They are always served as a download, never rendered.

## The MCP server

An agent connected through `board_mcp.py` can do what the Usability section
of Studio does, except delete. The main use is writing a study's tasks from
what a project's product really does: ask it, in the product's repository, to
"write usability study tasks for …"; it reads the code first. It can also run
the rest of a round: add participants, record captures during or after a
session, and write up observations from the insights.

| Tool | What it does |
|---|---|
| `study_task_guide` | How to write tasks: the fields, which half the participant sees, what makes a good set. Read first |
| `list_studies`, `get_study` | What exists: details and the whole content (research questions, protocol, consent form, tasks, script, words), file names |
| `create_study` | A new study with the default protocol, consent form and script, and no tasks |
| `update_study` | Details, status (open/closed), research questions, protocol, script (by section), word list |
| `clone_study` | A copy with the content and files and nobody in it |
| `export_study`, `import_study` | The Export document, written to / read from a JSON file in the project |
| `add_study_file`, `download_study_file` | Upload a file a task hands out (at most 2 MB, a data or text file from inside the project, never a hidden file or folder); save one locally |
| `add_study_tasks` | Append tasks in order. All or nothing, with the precise errors |
| `update_study_task` | Correct one task by id |
| `reorder_study_tasks` | A new order naming every task id once |
| `list_study_participants`, `add_study_participant`, `update_study_participant` | Who takes part, their name and contact email, their test account, booking and session notes. Never sends a booking email |
| `get_participant_capture`, `capture_study_task` | One participant's capture; the moderator's time, errors, outcome and notes per task |
| `get_study_insights` | The study across its participants: observations, measures and averages, word choices |
| `add_study_observation`, `update_study_observation` | What was seen, against which task and participants, and a proposed fix |

These call their own routes (`backend/app/studio/usability/agent_routes.py`,
under `…/usability/agent/…`), not the editor's, which stay closed to a board
token. The differences:

- **No link or password comes back.** A participant is returned without
  their link token, and the test account password is write-only (an agent
  sees `account_password_set`). Both would land in the agent's transcript. A
  person copies links from Studio and sends them.
- **Nothing is deleted** -- no study, task, participant, observation or file
  -- and tasks are never replaced wholesale. A reorder must name every task.
- **A closed study refuses changes** until `update_study(status="open")`.
  Creating, importing and cloning are the other writes it allows.
- **Where participants go and what they sign stay with a person.** An agent
  cannot set the application address (study or participant) or the consent
  wording; an imported study gets no address and the default consent
  wording. Agents read text participants typed (answers, consent name,
  words), and anyone holding a link can type it, so text written to steer
  an agent must not be able to send participants to another site. The tool
  descriptions also tell the agent to treat that text as data.
- A task may only list a file the study holds.
- The participant's own rating, answer, consent and word choices come only
  from their page.

A board token is confined to the project it was minted for, and only an
organisation admin can mint one. If the editor is open on the same study while
an agent writes to it, reload the page before editing: the editor saves the
whole content and would otherwise put back what it loaded.

The guide's text is `TASK_GUIDE` in `content.py`. The reachable routes are
listed, with the reason, in `tests/test_board_token_routes.py`. The MCP server
the team's sessions use runs the deployed `board_mcp.py`, so new tools appear
there only after a deploy and a session restart.

## Not built

- Raising an observation as a board requirement or feedback item.
- Choosing the application address from the project's environments (it is a
  plain field on the study, and every participant opens that one address;
  a participant has no address of their own).
- Sending the session link, recording, and the final report.
- Reminder emails before a session, and cancelling a booking from the booking page.
