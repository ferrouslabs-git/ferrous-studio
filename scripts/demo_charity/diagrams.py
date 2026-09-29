"""Six diagrams, one per kind the editor offers except ``usecase`` (the Use
cases tab draws that model itself from the actors and use cases).

Nodes are laid out on a grid by hand -- the importer only grid-places nodes
that arrive with no position, and a diagram bunched at the origin is not
something a client should see first.
"""
from __future__ import annotations

from typing import Any


def node(id: str, type: str, label: str, x: int, y: int, w: int | None = None, h: int | None = None, text: str | None = None, parentId: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"id": id, "type": type, "label": label, "x": x, "y": y}
    if w:
        out["w"] = w
    if h:
        out["h"] = h
    if text:
        out["text"] = text
    if parentId:
        out["parentId"] = parentId
    return out


def edge(id: str, source: str, target: str, type: str = "association", label: str = "") -> dict[str, Any]:
    return {"id": id, "type": type, "label": label, "source": source, "target": target}


def data_model() -> dict[str, Any]:
    W = 190
    col = lambda i: 40 + i * 270  # noqa: E731
    rowy = lambda j: 40 + j * 240  # noqa: E731

    def entity(id: str, label: str, c: int, r: int, fields: str) -> dict[str, Any]:
        # The compartment draws one line per field, so the box grows with them.
        lines = fields.count("\n") + 1
        return node(id, "entity", label, col(c), rowy(r), W, 46 + 15 * lines, text=fields)

    nodes = [
        entity("n-supporter", "Supporter", 0, 0, "id\nname\nemail\nphone\naddress\npostcode\nemail_consent\npost_consent"),
        entity("n-declaration", "GiftAidDeclaration", 1, 0, "id\nsupporter_id\ndeclared_on\nwording_version\nwithdrawn_on"),
        entity("n-donation", "Donation", 2, 0, "id\nsupporter_id\ncampaign_id\namount\ntype\nmethod\nreceived_on\ngift_aid_status"),
        entity("n-claim", "GiftAidClaim", 3, 0, "id\nperiod_from\nperiod_to\nstatus\nsubmitted_on\npaid_on\namount"),
        entity("n-event", "Event", 0, 1, "id\ntitle\ncategory\nstarts_at\nvenue\ncapacity\nstatus"),
        entity("n-ticket-type", "TicketType", 1, 1, "id\nevent_id\nname\nprice\nquantity"),
        entity("n-campaign", "Campaign", 2, 1, "id\nname\nfund (restricted?)\ntarget\nstarts_on\nends_on"),
        entity("n-payment", "Payment", 3, 1, "id\nprovider_ref\namount\nstatus\nsettled_on\nfailure_reason"),
        entity("n-volunteer", "Volunteer", 0, 2, "id\nsupporter_id\nroles\ndbs_expires_on\nstatus"),
        entity("n-booking", "Booking", 1, 2, "id\nevent_id\nsupporter_id\nticket_type_id\nquantity\nstatus\nchecked_in_at"),
        entity("n-shift", "Shift", 2, 2, "id\nevent_id\nvolunteer_id\nrole\nstarts_at\nends_at\nattended"),
        entity("n-user", "StaffUser", 3, 2, "id\nname\nemail\nrole\nlast_signed_in_at"),
    ]
    edges = [
        edge("e1", "n-supporter", "n-donation", label="1..*"),
        edge("e2", "n-supporter", "n-declaration", label="0..1"),
        edge("e3", "n-claim", "n-donation", label="includes"),
        edge("e4", "n-campaign", "n-donation", label="1..*"),
        edge("e5", "n-donation", "n-payment", label="0..1"),
        edge("e6", "n-booking", "n-payment", label="0..1"),
        edge("e7", "n-event", "n-ticket-type", label="1..*"),
        edge("e8", "n-event", "n-booking", label="1..*"),
        edge("e9", "n-supporter", "n-booking", label="1..*"),
        edge("e10", "n-supporter", "n-volunteer", label="0..1"),
        edge("e11", "n-volunteer", "n-shift", label="1..*"),
        edge("e12", "n-event", "n-shift", label="1..*"),
        edge("e13", "n-user", "n-donation", type="dependency", label="recorded by"),
    ]
    return {"name": "Data model", "kind": "class", "model": {"nodes": nodes, "edges": edges}}


def system_context() -> dict[str, Any]:
    nodes = [
        node("a-supporter", "actor", "Supporter", 40, 60, 40, 70),
        node("a-staff", "actor", "Office staff", 40, 220, 40, 70),
        node("a-volunteer", "actor", "Volunteer", 40, 380, 40, 70),
        node("a-trustee", "actor", "Trustee", 40, 540, 40, 70),
        node("s-hub", "rect", "Harbourside Hub", 300, 200, 260, 200, text="Brochure site, staff hub and mobile app"),
        node("x-stripe", "cloud", "Stripe", 720, 40, 170, 105, text="Card payments and Direct Debits"),
        node("x-hmrc", "cloud", "HMRC Charities Online", 720, 200, 170, 105, text="Gift Aid claims"),
        node("x-email", "cloud", "Email service", 720, 360, 170, 105, text="Receipts, reminders, newsletter"),
        node("x-accounts", "cloud", "Xero", 720, 520, 170, 105, text="Accounting"),
        node("x-sms", "cloud", "SMS gateway", 720, 680, 170, 105, text="Volunteer shift reminders"),
    ]
    edges = [
        edge("e1", "a-supporter", "s-hub", label="books, donates, reads news"),
        edge("e2", "a-staff", "s-hub", label="runs events and donations"),
        edge("e3", "a-volunteer", "s-hub", label="sees rota, checks in"),
        edge("e4", "a-trustee", "s-hub", label="reads reports, approves claims"),
        edge("e5", "s-hub", "x-stripe", type="directed", label="takes payments, receives webhooks"),
        edge("e6", "s-hub", "x-hmrc", type="directed", label="submits claim schedules"),
        edge("e7", "s-hub", "x-email", type="directed", label="sends transactional email"),
        edge("e8", "s-hub", "x-accounts", type="directed", label="posts daily income journal"),
        edge("e9", "s-hub", "x-sms", type="directed", label="sends reminders"),
    ]
    return {"name": "System context", "kind": "freeform", "model": {"nodes": nodes, "edges": edges}}


def containers() -> dict[str, Any]:
    nodes = [
        node("c-site", "rect", "Brochure site", 40, 40, 180, 90, text="Next.js, statically rendered"),
        node("c-app", "rect", "Hub web app", 300, 40, 180, 90, text="React single-page app"),
        node("c-mobile", "rect", "Hub mobile app", 560, 40, 180, 90, text="Same SPA, installed as a PWA"),
        node("c-api", "rect", "API", 300, 240, 180, 90, text="FastAPI, Python 3.12"),
        node("c-worker", "hexagon", "Background jobs", 560, 240, 180, 90, text="Receipts, reminders, retries"),
        node("c-db", "cylinder", "PostgreSQL", 300, 440, 120, 120, text="Managed, UK region"),
        node("c-files", "cylinder", "Object storage", 560, 440, 120, 120, text="Cover images, claim exports"),
        node("x-stripe", "cloud", "Stripe", 860, 140, 170, 105),
        node("x-hmrc", "cloud", "HMRC Charities Online", 860, 300, 170, 105),
        node("x-email", "cloud", "Email service", 860, 460, 170, 105),
    ]
    edges = [
        edge("e1", "c-site", "c-api", type="dependency", label="HTTPS / JSON"),
        edge("e2", "c-app", "c-api", type="dependency", label="HTTPS / JSON"),
        edge("e3", "c-mobile", "c-api", type="dependency", label="HTTPS / JSON, offline cache"),
        edge("e4", "c-api", "c-db", type="dependency", label="SQL"),
        edge("e5", "c-worker", "c-db", type="dependency", label="SQL"),
        edge("e6", "c-api", "c-files", type="dependency", label="presigned uploads"),
        edge("e7", "c-api", "x-stripe", type="dependency", label="payments API"),
        edge("e8", "x-stripe", "c-api", type="dependency", label="webhooks"),
        edge("e9", "c-worker", "x-hmrc", type="dependency", label="claim submission"),
        edge("e10", "c-worker", "x-email", type="dependency", label="SMTP API"),
    ]
    return {"name": "Containers", "kind": "freeform", "model": {"nodes": nodes, "edges": edges}}


def donation_journey() -> dict[str, Any]:
    X = 300
    nodes = [
        node("s", "start", "", X + 56, 20, 28, 28),
        node("a1", "action", "Choose amount and frequency", X, 90, 140, 50),
        node("d1", "decision", "UK taxpayer?", X + 40, 180, 60, 60),
        node("a2", "action", "Capture Gift Aid declaration", X + 220, 185, 140, 50),
        node("a3", "action", "Enter contact details", X, 290, 140, 50),
        node("a4", "action", "Pay with Stripe", X, 380, 140, 50),
        node("d2", "decision", "Payment succeeded?", X + 40, 470, 60, 60),
        node("a5", "action", "Show error and retry", X + 220, 475, 140, 50),
        node("a6", "action", "Create donation record", X, 580, 140, 50),
        node("f1", "fork", "", X, 670, 140, 8),
        node("a7", "action", "Email receipt", X - 180, 720, 140, 50),
        node("a8", "action", "Queue for Gift Aid claim", X, 720, 140, 50),
        node("a9", "action", "Post to accounts", X + 180, 720, 140, 50),
        node("f2", "fork", "", X, 810, 140, 8),
        node("e", "end", "", X + 54, 860, 32, 32),
        node("note", "note", "Gift Aid wording is fixed by HMRC and versioned; the declaration records which version the donor saw.", X + 420, 150, 220, 100),
    ]
    edges = [
        edge("e1", "s", "a1", type="flow"),
        edge("e2", "a1", "d1", type="flow"),
        edge("e3", "d1", "a2", type="flow", label="yes"),
        edge("e4", "d1", "a3", type="flow", label="no"),
        edge("e5", "a2", "a3", type="flow"),
        edge("e6", "a3", "a4", type="flow"),
        edge("e7", "a4", "d2", type="flow"),
        edge("e8", "d2", "a5", type="flow", label="no"),
        edge("e9", "a5", "a4", type="flow", label="retry"),
        edge("e10", "d2", "a6", type="flow", label="yes"),
        edge("e11", "a6", "f1", type="flow"),
        edge("e12", "f1", "a7", type="flow"),
        edge("e13", "f1", "a8", type="flow"),
        edge("e14", "f1", "a9", type="flow"),
        edge("e15", "a7", "f2", type="flow"),
        edge("e16", "a8", "f2", type="flow"),
        edge("e17", "a9", "f2", type="flow"),
        edge("e18", "f2", "e", type="flow"),
        edge("e19", "note", "a2", type="dependency"),
    ]
    return {"name": "Online donation journey", "kind": "activity", "model": {"nodes": nodes, "edges": edges}}


def gift_aid_sequence() -> dict[str, Any]:
    """Messages run between ACTIVATIONS, not lifelines: an edge between two
    lifelines is drawn centre to centre, so every message would land on the
    same line. Each message gets a short activation on both lifelines at its
    own height (child geometry is relative to the lifeline)."""
    L = 120, 640
    lanes = {"ops": 40, "hub": 300, "trustee": 560, "hmrc": 820}
    names = {"ops": "Operations Manager", "hub": "Harbourside Hub", "trustee": "Treasurer", "hmrc": "HMRC Charities Online"}
    nodes = [node(f"l-{k}", "lifeline", names[k], x, 40, *L) for k, x in lanes.items()]
    messages = [
        ("ops", "hub", "message", "1. Prepare claim for Jul to Sep"),
        ("hub", "ops", "message", "2. Draft schedule: £4,115 on £16,460 (38 excluded)"),
        ("ops", "trustee", "message", "3. Request approval"),
        ("trustee", "hub", "message", "4. Approve claim"),
        ("hub", "hmrc", "message", "5. Submit schedule (XML)"),
        ("hmrc", "hub", "messageAsync", "6. Acknowledgement and IRmark"),
        ("hmrc", "hub", "messageAsync", "7. Payment received (BACS, about 4 weeks)"),
        ("hub", "ops", "message", "8. Claim marked paid; donations marked Claimed"),
    ]
    edges = []
    for i, (src, dst, kind, label) in enumerate(messages):
        y = 130 + i * 60  # relative to the lifeline's top, below its head box
        for end in (src, dst):
            nodes.append(node(f"a-{i}-{end}", "activation", "", 54, y, 12, 28, parentId=f"l-{end}"))
        edges.append(edge(f"m{i + 1}", f"a-{i}-{src}", f"a-{i}-{dst}", type=kind, label=label))
    return {"name": "Gift Aid claim", "kind": "sequence", "model": {"nodes": nodes, "edges": edges}}


def event_lifecycle() -> dict[str, Any]:
    # Edge labels sit at each edge's midpoint, so states are spread out and
    # Sold out sits on its own row: two transitions between the same pair of
    # states would print their labels on top of each other, so the way back
    # from Sold out is a note rather than a second edge.
    S = 140, 60
    nodes = [
        node("s", "start", "", 40, 116, 28, 28),
        node("draft", "roundRect", "Draft", 140, 100, *S),
        node("published", "roundRect", "Published", 460, 100, *S),
        node("soldout", "roundRect", "Sold out", 780, 260, *S),
        node("completed", "roundRect", "Completed", 1100, 100, *S),
        node("cancelled", "roundRect", "Cancelled", 460, 420, *S),
        node("e", "end", "", 1340, 114, 32, 32),
        node("note", "note", "A cancelled booking takes a Sold out event back to Published until the places are gone again.", 1000, 360, 240, 90),
    ]
    edges = [
        edge("e1", "s", "draft", type="flow"),
        edge("e2", "draft", "published", type="flow", label="publish"),
        edge("e3", "published", "soldout", type="flow", label="capacity reached"),
        edge("e5", "published", "completed", type="flow", label="event date passes"),
        edge("e6", "soldout", "completed", type="flow", label="event date passes"),
        edge("e7", "draft", "cancelled", type="flow", label="cancel"),
        edge("e8", "published", "cancelled", type="flow", label="cancel and refund bookings"),
        edge("e9", "completed", "e", type="flow"),
        edge("e10", "cancelled", "e", type="flow"),
        edge("e11", "note", "soldout", type="dependency"),
    ]
    return {"name": "Event lifecycle", "kind": "state", "model": {"nodes": nodes, "edges": edges}}


def all_diagrams() -> list[dict[str, Any]]:
    return [data_model(), system_context(), containers(), donation_journey(), gift_aid_sequence(), event_lifecycle()]
