"""What a study contains, and the pure rules about it.

A study's ``content`` is one JSON document (see ``StudyContent`` in schemas.py):
research questions, the protocol and consent form a participant reads, the
tasks, the moderator's script and the word-choice list. Keeping it in one
document is what makes a study cheap to clone and to export.

Everything here is a plain function with no database, so the rules a mistake
would be costly in -- what a participant is allowed to see, how the averages
are worked out -- can be tested directly.
"""
from __future__ import annotations

import math
import secrets
from datetime import datetime, timedelta
from typing import Any

#: How many of their ticked words a participant picks as most descriptive.
TOP_WORDS = 5

#: The word list from the desirability exercise the participant sheet uses.
WORDS = [
    "Accessible", "Advanced", "Ambiguous", "Annoying", "Appealing", "Approachable", "Attractive",
    "Awkward", "Boring", "Bright", "Business-like", "Busy", "Clean", "Clear", "Cluttered",
    "Compelling", "Complex", "Comprehensive", "Confusing", "Consistent", "Contradictory",
    "Controllable", "Convenient", "Counter-intuitive", "Creative", "Credible", "Cutting edge",
    "Dated", "Desirable", "Difficult", "Distracting", "Dull", "Easy to use", "Effective",
    "Efficient", "Effortless", "Empowering", "Energetic", "Engaging", "Entertaining", "Exciting",
    "Expected", "Familiar", "Fast", "Faulty", "Flexible", "Fresh", "Friendly", "Frustrating",
    "Fun", "Hard to use", "High quality", "Illogical", "Impressive", "Inadequate",
    "Incomprehensible", "Inconsistent", "Ineffective", "Innovative", "Insecure", "Intimidating",
    "Intuitive", "Irrelevant", "Meaningful", "Misleading", "Motivating", "New", "Non-standard",
    "Obscure", "Old", "Ordinary", "Organised", "Overwhelming", "Patronising", "Poor quality",
    "Powerful", "Predictable", "Professional", "Relevant", "Reliable", "Responsive", "Rigid",
    "Satisfying", "Secure", "Simple", "Simplistic", "Slow", "Sophisticated", "Stable",
    "Stimulating", "Straightforward", "Stressful", "System-oriented", "Time-consuming",
    "Time-saving", "Too technical", "Trustworthy", "Unattractive", "Unconventional",
    "Understandable", "Unpredictable", "Unrefined", "Usable", "Useful", "Vague",
]

#: Task fields a participant may see. Everything else on a task (success,
#: path, watch, probes) is the moderator's and must never reach them.
PARTICIPANT_TASK_KEYS = ("id", "title", "scenario", "notes", "files", "answer_prompt")

SUCCESS_VALUES = ("complete", "help", "fail")

#: What a participant reads before the first task when the study tests signing
#: up: they create the account themselves, so they are given an address and an
#: email to use instead of a test account to sign in with.
SIGN_UP_TEXT = [
    "Open the application in a new tab using the link above, and keep this page open beside it.",
    "Do not create an account yet. A task will ask you to when the time comes.",
    "When you are asked for an email address, use the one shown here, not your own.",
    "You will choose your own password. Write it down, in case you need to sign in again during the session.",
]


#: The placeholders email copy may use. Anything else in braces is left as written.
EMAIL_PLACEHOLDERS = ("name", "study", "moderator", "organisation", "duration")

#: The two emails a participant is sent. Studio adds the parts that must always
#: be there (the booking button; the time, Meet link and rebooking link), so
#: the copy is only the words around them.
DEFAULT_EMAILS: dict[str, dict[str, Any]] = {
    "invite": {
        "subject": "Thank you for taking part in our research",
        "body": [
            "Hi {name},",
            "Thank you for agreeing to take part in a usability session with {organisation}. "
            "Your time and honest feedback make a real difference to what we build.",
            "The session takes {duration} on a video call with {moderator}. "
            "Please choose a time that suits you using the button below.",
        ],
    },
    "confirmation": {
        "subject": "Your usability session is booked",
        "body": [
            "Hi {name},",
            "Thank you for booking. Your session details are below, and a calendar invite is on its way.",
            "To prepare: join from a laptop or desktop computer with a reliable internet connection, "
            "in a quiet place. Please use Chrome, and have your camera and microphone ready, as we "
            "will ask you to share your screen.",
            "You do not need to prepare anything else. We are testing the product, not you.",
        ],
    },
}


def with_defaults(content: dict[str, Any]) -> dict[str, Any]:
    """A stored study's content with the fields added since it was written
    filled in, so a study made before them reads as it always did."""
    stored = content or {}
    emails = {
        kind: {**default, **((stored.get("emails") or {}).get(kind) or {})}
        for kind, default in DEFAULT_EMAILS.items()
    }
    return {"sign_up": False, "sign_up_text": list(SIGN_UP_TEXT), **stored, "emails": emails}


def render_copy(template: str, values: dict[str, str]) -> str:
    """Fill the known placeholders in one line of email copy. Plain text in,
    plain text out: the email escapes it, so a value cannot inject markup.
    An unknown or unbalanced placeholder is left exactly as written."""
    out = template
    for key in EMAIL_PLACEHOLDERS:
        out = out.replace("{" + key + "}", values.get(key, "") or "")
    return out


def slots(
    windows: list[tuple[datetime, datetime]],
    minutes: int,
    taken: list[tuple[datetime, datetime]],
    now: datetime,
    gap: int = 0,
) -> list[datetime]:
    """The free slot start times: each window cut, from its start, into
    ``minutes``-long slots with ``gap`` minutes between them (the last slot
    needs no gap after it; a remainder too short for a slot is dropped), less
    any that have started by ``now``, and any overlapping a ``taken`` interval
    (a booking, or a busy event on the moderator's calendar). Sorted, without
    duplicates."""
    if minutes <= 0:
        return []
    length = timedelta(minutes=minutes)
    step = timedelta(minutes=minutes + max(gap, 0))
    found: set[datetime] = set()
    for start, end in windows:
        at = start
        while at + length <= end:
            if at > now and not any(at < t_end and t_start < at + length for t_start, t_end in taken):
                found.add(at)
            at += step
    return sorted(found)


def new_task_id() -> str:
    """A short stable id. Results are keyed on it, so reordering or renaming
    a task never detaches what was captured for it."""
    return secrets.token_hex(4)


def default_content(organisation: str) -> dict[str, Any]:
    """What a new study starts with: a protocol, a consent form naming the
    organisation running the study, and a moderator's script. All editable."""
    return {
        "research_questions": [],
        "protocol": [
            "Thank you for agreeing to take part in this usability study. The intention is to evaluate "
            "the system you will be using, not your performance.",
            "The study has two parts: a set of tasks to complete, then a short word choice exercise.",
            "Before you begin each task, read it carefully and ask the moderator any questions you have. "
            "Tell the moderator when you are ready to begin and when you believe you have finished.",
            "While you work, please say out loud what you are thinking. This helps us find problems with "
            "the system. There are no wrong answers.",
        ],
        "consent_title": "Consent and recording release",
        "consent_text": [
            f"I agree to take part in this usability study, conducted and recorded by {organisation}.",
            f"I understand that the video session, including my screen and my voice, will be recorded, and "
            f"I consent to {organisation} using the recording. I understand that the recording, and the "
            f"notes, ratings and answers captured during the session, are for research purposes only and "
            f"that my name and image will not be used for any other purpose. I relinquish any rights to the "
            f"recording and understand it may be copied and used by {organisation} without further permission.",
            "I understand that taking part in this study is voluntary, and I agree to raise any concerns or "
            "areas of discomfort immediately with the study moderator.",
            "By typing my name below I confirm that I have read and understood this form, and that any "
            "questions I had about the session have been answered.",
        ],
        "sign_up": False,
        "sign_up_text": list(SIGN_UP_TEXT),
        "emails": {kind: {"subject": e["subject"], "body": list(e["body"])} for kind, e in DEFAULT_EMAILS.items()},
        "tasks": [],
        "script": {
            "before": [
                "Check this participant's sign-in details are filled in and the test account works.",
                "Send the participant their link at the start of the call, not before.",
                "Have the video call's recording ready, but do not start it yet.",
            ],
            "welcome": [
                "Thank you for giving us your time today. My name is ___ and I will be running this session.",
                "We are testing the system, not you. There are no wrong answers, and anything that is hard "
                "to do is our problem to fix.",
                "Please open the link I have just sent you. It explains the study and asks for your consent.",
                "With your agreement I am going to record this call, including your screen and what you say. "
                "Is that all right? I am starting the recording now.",
                "While you work, say out loud what you are thinking: what you are looking for, what you "
                "expect to happen, anything that surprises you.",
                "You can ask me questions, but sometimes I will not answer, because I want to see what "
                "happens when nobody is there to help.",
                "Do you have any questions before we start?",
            ],
            "per_task": [
                "Start the timer when they say they are starting. Stop it when they say they are done or give up.",
                "Count an error each time they take a wrong action they then have to undo or recover from.",
                "If they are stuck, give the smallest hint you can and record the task as complete with help.",
                "When they finish, ask them to give the ease rating on their page.",
            ],
            "wrap_up": [
                "Please finish with the word choice exercise on your page.",
                "Which part of what you did today was hardest? Why?",
                "If you could change one thing about what you used today, what would it be?",
                "Thank you. That is everything. I am stopping the recording now.",
            ],
            "after": [
                "Stop the recording and save it where the team keeps study recordings.",
                "Finish your notes for each task while the session is fresh.",
                "Add anything you saw to Study insights and mark this participant against it.",
            ],
        },
        "words": list(WORDS),
        "top_words": TOP_WORDS,
    }


def participant_content(content: dict[str, Any]) -> dict[str, Any]:
    """The part of a study a consenting participant may see: the protocol and
    each task without the moderator's notes."""
    return {
        "protocol": list(content.get("protocol", [])),
        "tasks": [{key: task.get(key) for key in PARTICIPANT_TASK_KEYS} for task in content.get("tasks", [])],
    }


def task_ids(content: dict[str, Any]) -> list[str]:
    return [task["id"] for task in content.get("tasks", [])]


def listed_files(content: dict[str, Any]) -> set[str]:
    """The file names any task hands to the participant. Only these are ever
    served to one, so a file added to the study but not to a task stays private."""
    return {name for task in content.get("tasks", []) for name in task.get("files", [])}


def clean_words(words: list[str], top_words: list[str], content: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Keep the words this study offers, once each, in the order given; the
    top words are those of them the participant also ticked."""
    offered = set(content.get("words", []))
    kept = [w for w in dict.fromkeys(words) if w in offered]
    top = [w for w in dict.fromkeys(top_words) if w in kept]
    return kept, top


def stats(values: list[float]) -> dict[str, float | int | None]:
    """Mean, count, standard deviation and 95% confidence, as the rainbow
    spreadsheet's Metrics sheet works them out: the sample deviation, and a
    confidence interval of 1.96 standard errors either side of the mean."""
    n = len(values)
    if n == 0:
        return {"count": 0, "mean": None, "sd": None, "ci95": None}
    mean = sum(values) / n
    if n == 1:
        return {"count": 1, "mean": mean, "sd": None, "ci95": None}
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1))
    return {"count": n, "mean": mean, "sd": sd, "ci95": 1.96 * sd / math.sqrt(n)}


def success_score(success: str | None) -> float | None:
    """Success as the spreadsheet scores it: 1 for completing unaided, 0 for
    completing with help or failing, nothing when it was not recorded."""
    if not success:
        return None
    return 1.0 if success == "complete" else 0.0


#: What an agent reads before writing a study's tasks (served by the agent
#: routes, shown by the MCP server's study_task_guide tool). Kept here, beside
#: the rules it describes, so the two cannot drift apart.
TASK_GUIDE = """\
WRITING USABILITY STUDY TASKS

A study is one round of remote, moderated usability testing. A participant
works through its tasks in the real product while a moderator watches. You
write the tasks from what the product actually does: read the repository's
routes, pages and features first, and write a task only for something you
found there. Never invent a feature.

WHAT IS BEING TESTED
How people use the application, not whether they can produce the material.
So everything a task needs is handed to the participant: the text to paste,
the dataset to upload, the definition to import. If a task needs a file,
upload it to the study first (add_study_file) and list its name in the
task's `files`. A file is at most 2 MB.

A TASK
Each task has a participant's half, which the participant reads, and a
moderator's half, which they never see.

Participant's half:
  title          Short name of the goal. "Create the function".
  scenario       The situation and the goal, in the participant's words, as
                 one short paragraph. Say what to achieve, never how: no
                 menu names, button labels or page names from the product,
                 because finding the way is what is being observed.
  notes          Things they need to know to do it, one per line: which file
                 to use, a value to enter. Not hints about where to click.
  files          Names of files already uploaded to this study.
  answer_prompt  Only when the task ends in something to find out. The
                 question they answer, e.g. "Which ticket scored lowest?".
                 Leave it out otherwise.

Moderator's half:
  success        What done looks like, observable from the screen.
  path           The shortest expected route through the product, with the
                 real names of the pages and controls.
  watch          What to look out for: where people are likely to hesitate.
  probes         Questions to ask afterwards, one per line. Open questions,
                 not leading ones.

A GOOD SET OF TASKS
- One outcome per task. If the scenario contains "and then", split it.
- In the order a real person would meet them, each building on the last.
- Five to ten tasks for a 60 minute session.
- Start with an easy one.
- Cover what the study's research questions ask. Write three to five
  research questions if the study has none: what the team wants to learn,
  each answerable by watching people do the tasks.
- British English. Plain words. No internal names a customer would not know.

WHAT YOU CANNOT CHANGE
The protocol, the consent form and the moderator's script are written by a
person in Studio, as are participants and everything captured in a session.
You cannot delete a task or a study; say so if one should go.

ORDER OF WORK
1. list_studies, then get_study if one exists, so you add to it and do not
   repeat what is there. Otherwise create_study.
2. add_study_file for each file a task will hand out.
3. add_study_tasks with all the tasks in order. It is all or nothing: any
   error names the task and the field, and nothing is added until it passes.
4. update_study_task to correct one task afterwards.
"""
