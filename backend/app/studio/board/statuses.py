"""The board's two status vocabularies, and the roll-up that derives one
from the other.

There are exactly two sets, and they answer different questions:

* **Work status** -- what state a piece of work is in. Carried by
  requirements, and *derived* (never stored) for the features and epics
  above them.
* **Delivery status** -- how far a body of work has been pushed towards
  live. Carried by sprints and releases, set by hand, and deliberately
  non-linear: a sprint may go back to ``ToTest`` after ``DeployedToUAT``
  without anything objecting.

Values are stored in the space-free form (``NotStarted``) and labelled for
display (``"Not started"``), the convention ``Epic.status`` already used
for ``ReleasedToUAT``. The stored form is what CSS class names and event
details are built from, so it must stay stable; only ``*_LABEL`` changes
if the wording does.
"""

__all__ = [
    "WORK_STATUSES",
    "WORK_STATUS_LABEL",
    "DELIVERY_STATUSES",
    "DELIVERY_STATUS_LABEL",
    "STATUS_WEIGHTS",
    "status_weight",
    "roll_up_status",
]

#: What a requirement can be in, and therefore what a feature or epic can
#: be rolled up to. ``Blocked`` is a flag rather than a stage -- see
#: Requirement's docstring and ``blocked_from``.
WORK_STATUSES = ("NotStarted", "InProgress", "ToTest", "Done", "Blocked")

WORK_STATUS_LABEL = {
    "NotStarted": "Not started",
    "InProgress": "In progress",
    "ToTest": "To test",
    "Done": "Done",
    "Blocked": "Blocked",
}

#: What a sprint or a release can be set to. No ``Done``: a body of work is
#: finished by being somewhere, and "deployed to live" is that somewhere.
#: Ordering here is display order only -- nothing treats it as a sequence.
DELIVERY_STATUSES = (
    "NotStarted",
    "InProgress",
    "ToTest",
    "DeployedToUAT",
    "DeployedToStaging",
    "DeployedToLive",
)

DELIVERY_STATUS_LABEL = {
    "NotStarted": "Not started",
    "InProgress": "In progress",
    "ToTest": "To test",
    "DeployedToUAT": "Deployed to UAT",
    "DeployedToStaging": "Deployed to Staging",
    "DeployedToLive": "Deployed to Live",
}

#: Status-weighted score: Done = 1, ToTest = 0.75 (implemented, awaiting a
#: human's approval), InProgress = 0.5, anything else 0. Mirrored exactly by
#: the frontend's effort.ts statusWeight(), so a figure computed here and one
#: computed there from the same requirements agree.
STATUS_WEIGHTS = {"Done": 1.0, "ToTest": 0.75, "InProgress": 0.5}


def status_weight(status: str) -> float:
    return STATUS_WEIGHTS.get(status, 0.0)


def roll_up_status(statuses) -> str:
    """The work status of a feature or an epic, given its requirements'.

    Progress dominates (chosen 2026-09-14): a single blocked requirement
    does not drag a mostly-finished epic to ``Blocked``. ``Blocked`` only
    surfaces once it is the *only* thing left unfinished, which is the point
    at which it genuinely describes the epic rather than one item under it.

    Precedence, first match wins::

        nothing under it            -> NotStarted
        every one Done              -> Done
        every one NotStarted        -> NotStarted
        every unfinished is Blocked -> Blocked
        every one Done or ToTest    -> ToTest
        otherwise                   -> InProgress

    A mix of ``Blocked`` and ``NotStarted`` therefore reads ``InProgress``:
    something has been picked up and run into a wall, which is a started
    epic with a blocked item in it, not a blocked epic.
    """
    seen = set(statuses)
    if not seen:
        return "NotStarted"
    if seen == {"Done"}:
        return "Done"
    if seen == {"NotStarted"}:
        return "NotStarted"
    if seen - {"Done"} == {"Blocked"}:
        return "Blocked"
    if seen <= {"Done", "ToTest"}:
        return "ToTest"
    return "InProgress"
