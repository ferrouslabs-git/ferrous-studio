"""The five wireframes, written in the import bundle's ``export_page`` shape.

Small builders keep each page readable and make it hard to break the
validator's rules by accident: every layout node gets a ``size``, every
component and element gets a page-unique id, links are written where the
canvas actually reads them (on the component, keyed ``el:<element id>``),
and element ``data`` only ever carries the fields the catalogue declares.

Two shells follow the Studio's outlet model: a shell page owns the
navigation and an empty content region, and every other page of that site
is *placed* into that region. The mobile app's shell puts its tab bar in a
bottom region, the way a phone app does.
"""
from __future__ import annotations

from typing import Any

# Dataset ids are bundle-local; the importer maps them to real rows.
DS_EVENT_STATUS = "ds-event-status"
DS_DONATION_TYPE = "ds-donation-type"
DS_GIFT_AID = "ds-gift-aid"
DS_PAYMENT_METHOD = "ds-payment-method"
DS_VOLUNTEER_ROLE = "ds-volunteer-role"
DS_BOOKING_STATUS = "ds-booking-status"
DS_EVENT_CATEGORY = "ds-event-category"

DATASETS = [
    {"id": DS_EVENT_STATUS, "name": "Event status", "kind": "status",
     "values": ["Draft", "Published", "Sold out", "Cancelled", "Completed"]},
    {"id": DS_DONATION_TYPE, "name": "Donation type", "kind": "text",
     "values": ["One-off", "Monthly", "Gift in kind", "Legacy pledge"]},
    {"id": DS_GIFT_AID, "name": "Gift Aid status", "kind": "status",
     "values": ["Declared", "Not declared", "Claimed", "Ineligible"]},
    {"id": DS_PAYMENT_METHOD, "name": "Payment method", "kind": "text",
     "values": ["Card", "Direct Debit", "Bank transfer", "Cash", "Cheque"]},
    {"id": DS_VOLUNTEER_ROLE, "name": "Volunteer role", "kind": "text",
     "values": ["Steward", "Driver", "Kitchen", "Fundraiser", "First aider", "Admin"]},
    {"id": DS_BOOKING_STATUS, "name": "Booking status", "kind": "status",
     "values": ["Confirmed", "Waiting list", "Cancelled", "Checked in"]},
    {"id": DS_EVENT_CATEGORY, "name": "Event category", "kind": "text",
     "values": ["Community", "Youth sailing", "Fundraiser", "Volunteering", "Talk"]},
]

BACK = "@back"


# ── Builders ─────────────────────────────────────────────────────────────


class P:
    """Mints page-unique ids: ``r-<page>-3``, ``c-<page>-4``, ``e-<page>-5``."""

    def __init__(self, pid: str):
        self.pid = pid
        self.n = 0

    def id(self, kind: str) -> str:
        self.n += 1
        return f"{kind}-{self.pid}-{self.n}"


def el(t: str, label: str = "", link: str | None = None, id: str | None = None, **data: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"type": t, "label": label}
    if id:
        out["id"] = id
    if data:
        out["data"] = {k: (v if isinstance(v, str) else str(v)) for k, v in data.items() if v is not None}
    if link:
        out["_link"] = link
    return out


def cmp(
    p: P,
    t: str,
    label: str,
    shape: str,
    layout: str,
    elements: list[dict[str, Any]],
    id: str | None = None,
    rows: int | None = None,
    **props: Any,
) -> dict[str, Any]:
    cid = id or p.id("c")
    els: list[dict[str, Any]] = []
    links: dict[str, Any] = {}
    for e in elements:
        e = dict(e)
        eid = e.get("id") or p.id("e")
        e["id"] = eid
        link = e.pop("_link", None)
        if link:
            links[f"el:{eid}"] = {"pageId": link}
        els.append(e)
    out: dict[str, Any] = {"id": cid, "type": t, "label": label, "shape": shape, "layout": layout, "elements": els}
    pr: dict[str, Any] = {k: v for k, v in props.items() if v is not None}
    if rows:
        pr["rows"] = [{} for _ in range(rows)]
    if links:
        pr["links"] = links
    if pr:
        out["props"] = pr
    return out


def region(
    p: P, label: str, size: Any, components: list[dict[str, Any]] | None = None, id: str | None = None, dir: str | None = None
) -> dict[str, Any]:
    out: dict[str, Any] = {"kind": "region", "id": id or p.id("r"), "label": label, "size": size, "components": components or []}
    if dir:
        out["dir"] = dir
    return out


def split(p: P, dir: str, size: Any, children: list[dict[str, Any]]) -> dict[str, Any]:
    return {"kind": "split", "id": p.id("s"), "dir": dir, "size": size, "children": children}


def page(
    pid: str,
    name: str,
    layout: dict[str, Any],
    route: str | None = None,
    placement: tuple[str, str] | None = None,
    presentation: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {"id": pid, "name": name, "layout": layout}
    if route is not None:
        out["route"] = route
    if placement:
        out["placement"] = {"page_id": placement[0], "region_id": placement[1]}
    if presentation:
        out["presentation"] = presentation
    return out


# Element shorthands -------------------------------------------------------

def nav(label: str, link: str | None = None, **data: Any) -> dict[str, Any]:
    return el("nav-item", label, link=link, **data)


def btn(label: str, link: str | None = None, style: str = "primary", **data: Any) -> dict[str, Any]:
    return el("button", label, link=link, style=style, **data)


def col(label: str, kind: str = "text", samples: str | None = None, dataset: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {"kind": kind}
    if dataset:
        data["dataset"] = dataset
    elif samples:
        data["samples"] = samples
    return el("column", label, **data)


def header(label: str, placement: str = "inline") -> dict[str, Any]:
    return el("header", label, placement=placement)


def stat(label: str, value: str, delta: str | None = None) -> dict[str, Any]:
    return el("stat", label, value=value, delta=delta)


def inp(label: str, kind: str = "text", placeholder: str | None = None) -> dict[str, Any]:
    return el("text-input", label, kind=kind, placeholder=placeholder)


def sel(label: str, options: str | None = None, dataset: str | None = None, selected: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if dataset:
        data["dataset"] = dataset
    elif options:
        data["options"] = options
    if selected:
        data["selected"] = selected
    return el("select", label, **data)


def filt(label: str, dataset: str | None = None, options: str | None = None, selected: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if dataset:
        data["dataset"] = dataset
    elif options:
        data["options"] = options
    if selected:
        data["selected"] = selected
    return el("filter", label, **data)


# Heights the canvas auto-stack allows each element type (px), so stacked
# elements never overlap. Long text gets a second line's worth.
_STACK_H = {
    "heading": 44, "text": 28, "label": 22, "badge": 32, "button": 46, "link": 26,
    "image": 150, "box": 90, "divider": 18, "text-input": 62, "select": 62, "checkbox": 30,
    "date-picker": 62, "text-area": 96, "radio-group": 40, "toggle": 30, "help-text": 24,
}


def stack(elements: list[dict[str, Any]], x: int = 24, y: int = 24, gap: int = 8, wrap_at: int = 90) -> list[dict[str, Any]]:
    """Give canvas elements ``data.x``/``data.y`` one under another."""
    out = []
    cursor = y
    for e in elements:
        e = dict(e)
        data = dict(e.get("data") or {})
        data.setdefault("x", str(x))
        data.setdefault("y", str(cursor))
        e["data"] = data
        h = _STACK_H.get(e["type"], 40)
        if e["type"] == "text" and len(e.get("label", "")) > wrap_at:
            h += 24 * (len(e["label"]) // wrap_at)
        cursor += h + gap
        out.append(e)
    return out


def row(elements: list[dict[str, Any]], y: int, x: int = 24, step: int = 170) -> list[dict[str, Any]]:
    """Canvas elements side by side on one line."""
    out = []
    for i, e in enumerate(elements):
        e = dict(e)
        data = dict(e.get("data") or {})
        data.setdefault("x", str(x + i * step))
        data.setdefault("y", str(y))
        e["data"] = data
        out.append(e)
    return out


def canvas(p: P, label: str, elements: list[dict[str, Any]], height: int = 280, shape: str = "plain", id: str | None = None, **props: Any) -> dict[str, Any]:
    return cmp(p, "canvas", label, shape, "fixed", elements, id=id, height=str(height), **props)


def canvas_h(elements: list[dict[str, Any]], base: int = 24, gap: int = 8, wrap_at: int = 90) -> int:
    """The height a stacked canvas needs to show every element."""
    h = base
    for e in elements:
        step = _STACK_H.get(e["type"], 40)
        if e["type"] == "text" and len(e.get("label", "")) > wrap_at:
            step += 24 * (len(e["label"]) // wrap_at)
        h += step + gap
    return h + 16


def text_block(p: P, label: str, elements: list[dict[str, Any]], shape: str = "transparent", x: int = 24, wrap_at: int = 90, id: str | None = None) -> dict[str, Any]:
    """A canvas whose elements are simply stacked, sized to fit."""
    return canvas(p, label, stack(elements, x=x, wrap_at=wrap_at), height=canvas_h(elements, wrap_at=wrap_at), shape=shape, id=id)


# ── Brochure site (desktop) ──────────────────────────────────────────────

BD_SHELL = "bd-shell"
BD_SHELL_CONTENT = "r-bd-shell-content"


def brochure_desktop() -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    placed = (BD_SHELL, BD_SHELL_CONTENT)

    # Home ----------------------------------------------------------------
    p = P("bd-home")
    hero = canvas(
        p, "Hero",
        stack([
            el("badge", "Registered charity 1123456", shape="pill"),
            el("heading", "Keeping our harbour community afloat"),
            el("text", "Food bank sessions, youth sailing and befriending for the people of Harbourside. Everything we do is funded by supporters like you."),
        ], x=48, y=48, gap=14)
        + row([btn("Donate now", "bd-donate"), btn("See what's on", "bd-events", style="secondary", fill="outline")], y=196, x=48, step=190),
        height=290, shape="card", id="c-bd-home-hero",
    )
    impact = cmp(p, "graph", "Our impact this year", "stats", "horizontal", [
        header("Our impact this year", "above"),
        stat("Meals served", "12,480", "+18% on last year"),
        stat("Young sailors trained", "214", "+31"),
        stat("Active volunteers", "96", "+9"),
        stat("Raised by supporters", "£184k", "+12%"),
    ])
    upcoming = cmp(p, "list", "Upcoming events", "cards", "grid", [
        header("Coming up", "above"),
        col("Event", "text", "Summer Regatta Dinner, Family Beach Clean, Sailing Taster Day"),
        col("When", "date", "Sat 18 Jul, Sun 26 Jul, Sat 8 Aug"),
        col("Category", "status", dataset=DS_EVENT_CATEGORY),
        col("Places left", "number", "12, 40, 6"),
        el("row-action", "Book", link="bd-event"),
    ], rows=3)
    news = cmp(p, "list", "Latest news", "feed", "vertical", [
        header("Latest news", "above"),
        col("Headline", "text", "Youth sailing crew wins regional regatta, New Tuesday food bank session opens, Thank you to our summer volunteers"),
        col("Posted", "date", "12 Sep 2026, 3 Sep 2026, 28 Aug 2026"),
        col("By", "person", "Dev Patel, Margaret Okafor, Sophie Lambert"),
        el("row-action", "Read", link="bd-story"),
    ], rows=3)
    pages.append(page("bd-home", "Home", region(p, "Home", {"fr": 1}, [hero, impact, upcoming, news]), route="/", placement=placed))

    # About ---------------------------------------------------------------
    p = P("bd-about")
    intro = text_block(p, "About the trust", [
        el("heading", "Who we are"),
        el("text", "Harbourside Community Trust was founded in 1998 by fishing families who wanted the harbour to keep looking after its own. Today we run three programmes from the Old Boathouse."),
        el("text", "We are a small team of two staff and nearly a hundred volunteers, governed by a board of seven trustees."),
    ], x=48)
    programmes = cmp(p, "list", "Our programmes", "cards", "grid", [
        header("Our programmes", "above"),
        col("Programme", "text", "Harbourside Food Bank, Youth Sailing Club, Befriending Service"),
        col("Who it is for", "text", "Families in the HB1 and HB2 postcodes, 10 to 17 year olds, Isolated older residents"),
        col("Since", "text", "2009, 2014, 2020"),
        el("row-action", "Find out more", link="bd-story"),
    ], rows=3)
    trustees = cmp(p, "list", "Trustees", "rows", "vertical", [
        header("Our trustees", "above"),
        col("Name", "person", "Alan Whitfield, Ruth Adeyemi, Colin Marsh, Farida Hussain"),
        col("Role", "text", "Treasurer, Chair, Safeguarding lead, Trustee"),
    ], rows=4)
    pages.append(page("bd-about", "About us", region(p, "About", {"fr": 1}, [intro, programmes, trustees]), route="/about", placement=placed))

    # What's on -------------------------------------------------------------
    p = P("bd-events")
    events = cmp(p, "list", "What's on", "cards", "grid", [
        header("What's on"),
        el("search", "Search events"),
        filt("Category", dataset=DS_EVENT_CATEGORY),
        filt("Month", options="Any month, July, August, September", selected="Any month"),
        col("Event", "text", "Summer Regatta Dinner, Family Beach Clean, Sailing Taster Day, Harbour History Talk, Volunteer Induction, Autumn Quiz Night"),
        col("When", "date", "Sat 18 Jul 19:00, Sun 26 Jul 10:00, Sat 8 Aug 09:30, Thu 20 Aug 19:30, Sat 5 Sep 10:00, Fri 25 Sep 19:00"),
        col("Category", "status", dataset=DS_EVENT_CATEGORY),
        col("Price", "currency", "£35, Free, £10, £5, Free, £8"),
        col("Places left", "number", "12, 40, 6, 25, 15, 60"),
        el("row-action", "Book", link="bd-event"),
        el("pagination", "", pageSize="6"),
    ], rows=6, id="c-bd-events-list")
    pages.append(page("bd-events", "What's on", region(p, "What's on", {"fr": 1}, [events]), route="/events", placement=placed))

    # Event detail ----------------------------------------------------------
    p = P("bd-event")
    detail = canvas(
        p, "Event details",
        stack([
            el("badge", "Fundraiser", shape="pill"),
            el("heading", "Summer Regatta Dinner"),
            el("label", "When"),
            el("text", "Saturday 18 July 2026, 7 pm until late"),
            el("label", "Where"),
            el("text", "Harbourside Sailing Club, The Quay, Harbourside HB1 2QY"),
            el("label", "Tickets"),
            el("text", "£35 adult · £15 under 16 · table of ten £300. All proceeds fund the youth sailing bursary."),
            el("text", "Three courses from the club galley, live music from the Shanty Crew and the annual auction of promises. Dress: smart casual, deck shoes optional."),
        ], x=48, y=32, gap=6)
        + row([btn("Book tickets", "bd-book"), btn("Add to calendar", style="secondary", fill="outline"), el("link", "Share", link="bd-contact")], y=372, x=48, step=180),
        height=440, shape="card",
    )
    also = cmp(p, "list", "Also coming up", "rows", "horizontal", [
        header("Also coming up", "above"),
        col("Event", "text", "Family Beach Clean, Sailing Taster Day, Harbour History Talk"),
        col("When", "date", "Sun 26 Jul, Sat 8 Aug, Thu 20 Aug"),
        el("row-action", "View", link="bd-event"),
    ], rows=3)
    pages.append(page("bd-event", "Event detail", region(p, "Event", {"fr": 1}, [detail, also]), route="/events/summer-regatta-dinner", placement=placed))

    # Book tickets (modal) ------------------------------------------------
    p = P("bd-book")
    form = cmp(p, "form", "Book tickets", "wizard", "one-column", [
        header("Book tickets · Summer Regatta Dinner"),
        el("step", "Tickets"), el("step", "Your details"), el("step", "Payment"),
        sel("Adult tickets (£35)", options="1, 2, 3, 4, 5, 6", selected="2"),
        sel("Under 16 tickets (£15)", options="0, 1, 2, 3, 4", selected="0"),
        el("checkbox", "Book a full table of ten (£300)"),
        inp("Full name", placeholder="Priya Nair"),
        inp("Email", "email", "priya@example.org"),
        inp("Mobile", "phone", "07700 900123"),
        el("text-area", "Dietary requirements", placeholder="Vegetarian, allergies…"),
        el("checkbox", "Keep me posted about future events"),
        btn("Cancel", BACK, style="secondary"),
        btn("Pay £70", "bd-thanks"),
    ], id="c-bd-book-form")
    pages.append(page("bd-book", "Book tickets", region(p, "Book tickets", {"fr": 1}, [form]), presentation="modal"))

    # Donate ----------------------------------------------------------------
    p = P("bd-donate")
    donate = cmp(p, "form", "Make a donation", "sections", "one-column", [
        header("Make a donation"),
        el("section-heading", "Your gift"),
        el("radio-group", "How often", options="One-off, Monthly"),
        el("radio-group", "Amount", options="£10, £25, £50, Other"),
        inp("Other amount (£)", "number", "0.00"),
        sel("Where should your gift go?", options="Where it is needed most, Food bank, Youth sailing, Befriending", selected="Where it is needed most"),
        el("section-heading", "Gift Aid"),
        el("checkbox", "I am a UK taxpayer and would like Harbourside Community Trust to claim Gift Aid on this and any future donations", id="e-bd-donate-giftaid"),
        el("help-text", "Gift Aid adds 25p to every £1 you give, at no cost to you. You must pay at least as much income or capital gains tax as the trust reclaims."),
        el("section-heading", "Your details"),
        inp("Full name", placeholder="Tom Reeves"),
        inp("Email", "email", "tom@example.org"),
        inp("Home address", placeholder="14 Quay Cottages"),
        inp("Postcode", placeholder="HB1 3DR"),
        el("checkbox", "Send me the quarterly newsletter by email"),
        btn("Continue to payment", "bd-thanks"),
    ], id="c-bd-donate-form")
    why = text_block(p, "Why give?", [
        el("heading", "What your gift does"),
        el("label", "£10"),
        el("text", "Feeds a family of four for a weekend from the food bank."),
        el("label", "£25"),
        el("text", "Pays for one young person's first sailing session, buoyancy aid included."),
        el("label", "£50"),
        el("text", "Covers a month of befriending visits for an isolated neighbour."),
        el("divider"),
        el("text", "Every pound is spent locally. Our accounts are published each year and audited by an independent examiner."),
    ], shape="card", wrap_at=60)
    layout = split(p, "row", {"fr": 1}, [region(p, "Donation form", {"fr": 2}, [donate]), region(p, "Why give", {"fr": 1}, [why])])
    pages.append(page("bd-donate", "Donate", layout, route="/donate", placement=placed))

    # Thank you (modal) -----------------------------------------------------
    p = P("bd-thanks")
    thanks = canvas(p, "Thank you", stack([
        el("heading", "Thank you"),
        el("text", "Your support keeps the harbour community afloat. A confirmation email is on its way and a receipt will follow shortly."),
        el("text", "If you ticked Gift Aid, we will claim an extra 25p for every £1 you gave."),
    ], x=32, y=32, gap=12) + row([btn("Back to the site", "bd-home"), el("link", "Share on social media", link="bd-contact")], y=200, x=32, step=200), height=270, shape="card")
    pages.append(page("bd-thanks", "Thank you", region(p, "Thank you", {"fr": 1}, [thanks]), presentation="modal"))

    # Volunteer -------------------------------------------------------------
    p = P("bd-volunteer")
    intro = text_block(p, "Volunteering", [
        el("heading", "Volunteer with us"),
        el("text", "Nearly a hundred people give their time to the trust every month. Most volunteer for two or three hours a week; some come once a year for the regatta."),
        el("text", "We provide induction, a DBS check where the role needs one, and a very good cup of tea."),
    ], x=48)
    roles = cmp(p, "list", "Roles we need", "cards", "grid", [
        header("Roles we need right now", "above"),
        col("Role", "text", "Food bank steward, Sailing club driver, Befriending visitor, Regatta first aider"),
        col("When", "text", "Tuesday mornings, Saturday mornings, Flexible, 18 July"),
        col("DBS needed", "boolean", "Yes, Yes, Yes, No"),
    ], rows=4)
    form = cmp(p, "form", "Volunteer application", "simple", "two-column", [
        header("Apply to volunteer", "above"),
        inp("Full name"), inp("Email", "email"), inp("Mobile", "phone"), inp("Postcode"),
        sel("Preferred role", dataset=DS_VOLUNTEER_ROLE),
        el("radio-group", "Availability", options="Weekdays, Weekends, Either"),
        el("text-area", "Tell us a little about yourself", placeholder="Experience, interests, anything we should know"),
        el("checkbox", "I am happy to be contacted about volunteering opportunities"),
        btn("Send application", "bd-thanks"),
    ], id="c-bd-volunteer-form")
    pages.append(page("bd-volunteer", "Volunteer", region(p, "Volunteer", {"fr": 1}, [intro, roles, form]), route="/volunteer", placement=placed))

    # News ------------------------------------------------------------------
    p = P("bd-news")
    feed = cmp(p, "list", "News", "feed", "vertical", [
        header("News and stories"),
        filt("Topic", options="All, Food bank, Youth sailing, Befriending, Fundraising", selected="All"),
        col("Headline", "text", "Youth sailing crew wins regional regatta, New Tuesday food bank session opens, Thank you to our summer volunteers, Regatta dinner raises £11.4k, Befriending service marks a thousand visits"),
        col("Posted", "date", "12 Sep 2026, 3 Sep 2026, 28 Aug 2026, 20 Jul 2026, 2 Jul 2026"),
        col("By", "person", "Dev Patel, Margaret Okafor, Sophie Lambert, Dev Patel, Margaret Okafor"),
        el("row-action", "Read", link="bd-story"),
        el("pagination", "", pageSize="10"),
    ], rows=5)
    pages.append(page("bd-news", "News", region(p, "News", {"fr": 1}, [feed]), route="/news", placement=placed))

    # Story -----------------------------------------------------------------
    p = P("bd-story")
    story = canvas(p, "Story", stack([
        el("label", "Youth sailing · 12 September 2026"),
        el("heading", "Youth sailing crew wins regional regatta"),
        el("image", "Photo of the crew on the podium at Westbay"),
        el("text", "Six of our under-16 crew took first place in the Westbay regional regatta on Saturday, the club's best result in its twelve-year history."),
        el("text", "Coach Amira Shah said the result was down to a winter of Tuesday-evening training in the boathouse. Three of the crew joined through the food bank's family programme."),
        el("text", "The bursary fund, which pays for kit and travel for young people who could not otherwise take part, is the beneficiary of this year's regatta dinner."),
    ], x=48, y=32, gap=10) + row([btn("Support the bursary", "bd-donate"), el("link", "All news", link="bd-news")], y=560, x=48, step=220), height=630, wrap_at=100)
    pages.append(page("bd-story", "News story", region(p, "Story", {"fr": 1}, [story]), route="/news/regatta-win", placement=placed))

    # Contact ---------------------------------------------------------------
    p = P("bd-contact")
    form = cmp(p, "form", "Contact us", "simple", "one-column", [
        header("Get in touch"),
        inp("Your name"), inp("Email", "email"),
        sel("What is it about?", options="General enquiry, Donations, Events, Volunteering, Press", selected="General enquiry"),
        el("text-area", "Message"),
        btn("Send message", "bd-thanks"),
    ])
    where = text_block(p, "Find us", [
        el("heading", "The Old Boathouse"),
        el("text", "Quay Street, Harbourside HB1 2QY"),
        el("text", "01234 567890 · hello@harboursidetrust.example.org"),
        el("label", "Office hours"),
        el("text", "Monday to Friday, 9 am to 4 pm"),
        el("image", "Map showing the boathouse on the east quay"),
    ], shape="card", wrap_at=60)
    layout = split(p, "row", {"fr": 1}, [region(p, "Contact form", {"fr": 1}, [form]), region(p, "Find us", {"fr": 1}, [where])])
    pages.append(page("bd-contact", "Contact", layout, route="/contact", placement=placed))

    # Newsletter (drawer) --------------------------------------------------
    p = P("bd-newsletter")
    form = cmp(p, "form", "Newsletter", "simple", "one-column", [
        header("Join our newsletter"),
        el("help-text", "One email a quarter with news from the harbour. Unsubscribe any time."),
        inp("Email", "email", "you@example.org"),
        inp("First name"),
        el("checkbox", "I agree to receive the newsletter by email"),
        btn("Not now", BACK, style="secondary"), btn("Subscribe", "bd-thanks"),
    ])
    pages.append(page("bd-newsletter", "Newsletter sign-up", region(p, "Newsletter", {"fr": 1}, [form]), presentation="drawer"))

    # Shell (last: every nav link now resolves) ---------------------------
    p = P("bd-shell")
    # Contact lives in the footer: six items plus the brand and the Donate
    # button overflow a horizontal bar on a narrow desktop.
    top = cmp(p, "navbar", "Site navigation", "plain", "horizontal", [
        el("brand", "Harbourside Trust", link="bd-home", logo="wave"),
        nav("Home", "bd-home"), nav("About", "bd-about"), nav("What's on", "bd-events"),
        nav("News", "bd-news"), nav("Volunteer", "bd-volunteer"),
        btn("Donate", "bd-donate"),
    ], id="c-bd-shell-nav")
    footer = canvas(p, "Footer", stack([
        el("heading", "Harbourside Community Trust"),
        el("text", "Registered charity 1123456 · The Old Boathouse, Quay Street, Harbourside HB1 2QY"),
    ], x=48, y=24, gap=6) + row([
        el("link", "Newsletter", link="bd-newsletter"), el("link", "Privacy"), el("link", "Safeguarding"), el("link", "Accounts"), el("link", "Contact", link="bd-contact"),
    ], y=120, x=48, step=120), height=160, shape="transparent")
    layout = split(p, "col", {"fr": 1}, [
        region(p, "Nav", "auto", [top]),
        region(p, "Content", {"fr": 1}, [], id=BD_SHELL_CONTENT),
        region(p, "Footer", "auto", [footer]),
    ])
    pages.append(page(BD_SHELL, "Site shell", layout, route="/"))

    return {
        "name": "Brochure site (desktop)",
        "interfaceType": "desktop",
        "landingPageId": "bd-home",
        "personas": ["Tom Reeves", "Priya Nair"],
        "userTypes": ["Supporter", "Donor", "Event attendee", "Volunteer"],
        "pages": pages,
    }


# ── Brochure site (mobile) ────────────────────────────────────────────────

BM_SHELL = "bm-shell"
BM_SHELL_CONTENT = "r-bm-shell-content"


def brochure_mobile() -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    placed = (BM_SHELL, BM_SHELL_CONTENT)
    W = 40  # wrap threshold for a 390px column

    p = P("bm-home")
    hero = canvas(p, "Hero", stack([
        el("badge", "Registered charity", shape="pill"),
        el("heading", "Keeping our harbour community afloat"),
        el("text", "Food bank, youth sailing and befriending, funded by people like you."),
    ], x=20, y=20, gap=10, wrap_at=W) + row([btn("Donate", "bm-donate"), btn("What's on", "bm-events", style="secondary", fill="outline")], y=196, x=20, step=130), height=264, shape="card", id="c-bm-home-hero")
    impact = cmp(p, "graph", "Impact", "stats", "horizontal", [
        stat("Meals served", "12,480", "+18%"), stat("Young sailors", "214", "+31"),
    ])
    upcoming = cmp(p, "list", "Coming up", "cards", "vertical", [
        header("Coming up", "above"),
        col("Event", "text", "Summer Regatta Dinner, Family Beach Clean, Sailing Taster Day"),
        col("When", "date", "Sat 18 Jul, Sun 26 Jul, Sat 8 Aug"),
        col("Category", "status", dataset=DS_EVENT_CATEGORY),
        el("row-action", "Book", link="bm-event"),
    ], rows=3)
    pages.append(page("bm-home", "Home", region(p, "Home", {"fr": 1}, [hero, impact, upcoming]), route="/", placement=placed))

    p = P("bm-about")
    pages.append(page("bm-about", "About us", region(p, "About", {"fr": 1}, [
        text_block(p, "About", [
            el("heading", "Who we are"),
            el("text", "Founded in 1998 by fishing families who wanted the harbour to look after its own."),
            el("text", "Two staff, nearly a hundred volunteers and seven trustees."),
        ], x=20, wrap_at=W),
        cmp(p, "list", "Programmes", "rows", "vertical", [
            header("Our programmes", "above"),
            col("Programme", "text", "Food Bank, Youth Sailing Club, Befriending Service"),
            col("Since", "text", "2009, 2014, 2020"),
        ], rows=3),
    ]), route="/about", placement=placed))

    p = P("bm-events")
    pages.append(page("bm-events", "What's on", region(p, "What's on", {"fr": 1}, [
        cmp(p, "list", "What's on", "cards", "vertical", [
            header("What's on"),
            el("search", "Search"),
            filt("Category", dataset=DS_EVENT_CATEGORY),
            col("Event", "text", "Summer Regatta Dinner, Family Beach Clean, Sailing Taster Day, Harbour History Talk"),
            col("When", "date", "Sat 18 Jul 19:00, Sun 26 Jul 10:00, Sat 8 Aug 09:30, Thu 20 Aug 19:30"),
            col("Category", "status", dataset=DS_EVENT_CATEGORY),
            col("Price", "currency", "£35, Free, £10, £5"),
            el("row-action", "Book", link="bm-event"),
        ], rows=4, id="c-bm-events-list"),
    ]), route="/events", placement=placed))

    p = P("bm-event")
    detail = canvas(p, "Event", stack([
        el("badge", "Fundraiser", shape="pill"),
        el("heading", "Summer Regatta Dinner"),
        el("label", "When"), el("text", "Sat 18 July 2026, 7 pm"),
        el("label", "Where"), el("text", "Harbourside Sailing Club, HB1 2QY"),
        el("label", "Tickets"), el("text", "£35 adult · £15 under 16"),
        el("text", "Three courses, live music from the Shanty Crew and the auction of promises."),
    ], x=20, y=20, gap=6, wrap_at=W) + row([btn("Book tickets", "bm-book")], y=400, x=20), height=470, shape="card")
    pages.append(page("bm-event", "Event detail", region(p, "Event", {"fr": 1}, [detail]), route="/events/summer-regatta-dinner", placement=placed))

    p = P("bm-book")
    pages.append(page("bm-book", "Book tickets", region(p, "Book", {"fr": 1}, [
        cmp(p, "form", "Book tickets", "wizard", "one-column", [
            header("Book tickets"),
            el("step", "Tickets"), el("step", "Details"), el("step", "Pay"),
            sel("Adult (£35)", options="1, 2, 3, 4", selected="2"),
            sel("Under 16 (£15)", options="0, 1, 2, 3", selected="0"),
            inp("Full name"), inp("Email", "email"), inp("Mobile", "phone"),
            btn("Cancel", BACK, style="secondary"), btn("Pay £70", "bm-thanks"),
        ]),
    ]), presentation="modal"))

    p = P("bm-donate")
    pages.append(page("bm-donate", "Donate", region(p, "Donate", {"fr": 1}, [
        cmp(p, "form", "Donate", "sections", "one-column", [
            header("Make a donation"),
            el("section-heading", "Your gift"),
            el("radio-group", "How often", options="One-off, Monthly"),
            el("radio-group", "Amount", options="£10, £25, £50, Other"),
            inp("Other amount (£)", "number"),
            el("section-heading", "Gift Aid"),
            el("checkbox", "I am a UK taxpayer and want the trust to claim Gift Aid"),
            el("help-text", "Adds 25p to every £1 at no cost to you."),
            el("section-heading", "Your details"),
            inp("Full name"), inp("Email", "email"), inp("Home address"), inp("Postcode"),
            btn("Continue to payment", "bm-thanks"),
        ], id="c-bm-donate-form"),
    ]), route="/donate", placement=placed))

    p = P("bm-thanks")
    pages.append(page("bm-thanks", "Thank you", region(p, "Thank you", {"fr": 1}, [
        canvas(p, "Thank you", stack([
            el("heading", "Thank you"),
            el("text", "A confirmation email is on its way. Your support keeps the harbour community afloat."),
        ], x=20, y=20, gap=10, wrap_at=W) + row([btn("Back to the site", "bm-home")], y=170, x=20), height=240, shape="card"),
    ]), presentation="modal"))

    p = P("bm-volunteer")
    pages.append(page("bm-volunteer", "Volunteer", region(p, "Volunteer", {"fr": 1}, [
        text_block(p, "Volunteering", [
            el("heading", "Volunteer with us"),
            el("text", "Two or three hours a week makes a real difference. Induction and DBS checks provided."),
        ], x=20, wrap_at=W),
        cmp(p, "form", "Apply", "simple", "one-column", [
            header("Apply", "above"),
            inp("Full name"), inp("Email", "email"), inp("Mobile", "phone"),
            sel("Preferred role", dataset=DS_VOLUNTEER_ROLE),
            el("radio-group", "Availability", options="Weekdays, Weekends, Either"),
            btn("Send application", "bm-thanks"),
        ]),
    ]), route="/volunteer", placement=placed))

    p = P("bm-news")
    pages.append(page("bm-news", "News", region(p, "News", {"fr": 1}, [
        cmp(p, "list", "News", "feed", "vertical", [
            header("News"),
            col("Headline", "text", "Youth sailing crew wins regional regatta, New Tuesday food bank session opens, Thank you to our summer volunteers"),
            col("Posted", "date", "12 Sep, 3 Sep, 28 Aug"),
            col("By", "person", "Dev Patel, Margaret Okafor, Sophie Lambert"),
            el("row-action", "Read", link="bm-story"),
        ], rows=3),
    ]), route="/news", placement=placed))

    p = P("bm-story")
    pages.append(page("bm-story", "News story", region(p, "Story", {"fr": 1}, [
        canvas(p, "Story", stack([
            el("label", "Youth sailing · 12 Sep 2026"),
            el("heading", "Crew wins regional regatta"),
            el("image", "Crew on the podium"),
            el("text", "Six of our under-16 crew took first place at Westbay, the club's best result in twelve years."),
            el("text", "Three of the crew joined through the food bank's family programme."),
        ], x=20, y=20, gap=8, wrap_at=W) + row([btn("Support the bursary", "bm-donate")], y=470, x=20), height=540, wrap_at=W),
    ]), route="/news/regatta-win", placement=placed))

    p = P("bm-contact")
    pages.append(page("bm-contact", "Contact", region(p, "Contact", {"fr": 1}, [
        text_block(p, "Find us", [
            el("heading", "The Old Boathouse"),
            el("text", "Quay Street, Harbourside HB1 2QY"),
            el("text", "01234 567890"),
            el("text", "hello@harboursidetrust.example.org"),
        ], x=20, shape="card", wrap_at=W),
        cmp(p, "form", "Message", "simple", "one-column", [
            header("Send a message", "above"),
            inp("Your name"), inp("Email", "email"), el("text-area", "Message"),
            btn("Send", "bm-thanks"),
        ]),
    ]), route="/contact", placement=placed))

    # Menu drawer, then the shell
    p = P("bm-menu")
    pages.append(page("bm-menu", "Menu", region(p, "Menu", {"fr": 1}, [
        cmp(p, "navbar", "Menu", "plain", "vertical", [
            el("brand", "Harbourside Community Trust", logo="wave"),
            nav("Home", "bm-home"), nav("About", "bm-about"), nav("What's on", "bm-events"),
            nav("News", "bm-news"), nav("Volunteer", "bm-volunteer"), nav("Contact", "bm-contact"),
            el("divider"),
            btn("Donate", "bm-donate"),
        ]),
    ]), presentation="drawer-left"))

    p = P("bm-shell")
    top = cmp(p, "navbar", "Top bar", "plain", "horizontal", [
        el("brand", "Harbourside", link="bm-home", logo="wave"),
        btn("Menu", "bm-menu", style="secondary", fill="ghost"),
        btn("Donate", "bm-donate"),
    ], id="c-bm-shell-nav")
    layout = split(p, "col", {"fr": 1}, [
        region(p, "Nav", "auto", [top]),
        region(p, "Content", {"fr": 1}, [], id=BM_SHELL_CONTENT),
    ])
    pages.append(page(BM_SHELL, "Site shell", layout, route="/"))

    return {
        "name": "Brochure site (mobile)",
        "interfaceType": "mobile",
        "landingPageId": "bm-home",
        "personas": ["Tom Reeves", "Priya Nair"],
        "userTypes": ["Supporter", "Donor", "Event attendee"],
        "pages": pages,
    }


# ── Hub app (desktop) ────────────────────────────────────────────────────

HD_SHELL = "hd-shell"
HD_SHELL_CONTENT = "r-hd-shell-content"
HD_EVENT_CONTENT = "r-hd-event-content"
HD_SUPPORTER_CONTENT = "r-hd-supporter-content"


def event_form(p: P, title: str, save_link: str) -> dict[str, Any]:
    return cmp(p, "form", title, "sections", "one-column", [
        header(title),
        el("section-heading", "Details"),
        inp("Title", placeholder="Summer Regatta Dinner"),
        sel("Category", dataset=DS_EVENT_CATEGORY),
        el("date-picker", "Date"),
        inp("Start time", placeholder="19:00"),
        inp("Venue", placeholder="Harbourside Sailing Club"),
        inp("Capacity", "number", "180"),
        el("text-area", "Description"),
        el("file-upload", "Cover image"),
        el("section-heading", "Tickets"),
        el("toggle", "Free event"),
        inp("Adult price (£)", "number", "35.00"),
        inp("Under 16 price (£)", "number", "15.00"),
        el("toggle", "Allow a waiting list once sold out"),
        el("section-heading", "Publishing"),
        sel("Status", dataset=DS_EVENT_STATUS, selected="Draft"),
        el("checkbox", "Show on the public website"),
        btn("Cancel", BACK, style="secondary"),
        btn("Save event", save_link),
    ])


def hub_desktop() -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    placed = (HD_SHELL, HD_SHELL_CONTENT)

    # Dashboard -------------------------------------------------------------
    p = P("hd-dashboard")
    kpis = cmp(p, "graph", "Headline figures", "stats", "horizontal", [
        stat("Raised this month", "£18,420", "+12% vs Aug"),
        stat("Regular givers", "312", "+4"),
        stat("Upcoming events", "6", "2 this week"),
        stat("Gift Aid to claim", "£4,115", "since 3 Jul"),
    ], id="c-hd-dashboard-kpis")
    income = cmp(p, "graph", "Income by month", "bar", "vertical", [
        header("Income by month"),
        el("series", "Donations", values="9800, 11200, 8400, 15600, 12100, 18420"),
        el("series", "Events", values="1200, 3400, 11400, 2100, 900, 2600"),
        el("category-axis", "", categories="Apr, May, Jun, Jul, Aug, Sep"),
        el("value-axis", "£", unit="£"),
        el("legend", ""),
        el("range-selector", "This financial year"),
    ])
    # A pie or donut draws ONE series' values as its slices and names them
    # from the category axis (Schematic's renderGraph).
    sources = cmp(p, "graph", "Income by source", "donut", "vertical", [
        header("Income by source"),
        el("series", "Share of income", values="41, 27, 19, 13"),
        el("category-axis", "", categories="Regular giving, One-off donations, Events, Grants"),
    ])
    activity = cmp(p, "list", "Recent activity", "feed", "vertical", [
        header("Recent activity"),
        col("What happened", "text", "Monthly gift of £15 from Tom Reeves, 2 tickets booked for Summer Regatta Dinner, Gift Aid declaration added for Ruth Adeyemi, Offline donation of £200 recorded (cheque), Volunteer Sam Okoro checked in at the food bank"),
        col("When", "time", "2 min ago, 14 min ago, 1 hr ago, 3 hr ago, Yesterday"),
        col("By", "person", "Tom Reeves, Priya Nair, Margaret Okafor, Margaret Okafor, Sophie Lambert"),
    ], rows=5)
    week = cmp(p, "list", "This week's events", "rows", "vertical", [
        header("This week"),
        col("Event", "text", "Tuesday food bank session, Sailing club training, Autumn Quiz Night"),
        col("When", "date", "Tue 29 Sep 09:00, Thu 1 Oct 18:30, Fri 2 Oct 19:00"),
        col("Booked", "text", "n/a, 18 of 24, 96 of 120"),
        el("row-action", "Open", link="hd-event-bookings"),
    ], rows=3)
    layout = split(p, "col", {"fr": 1}, [
        region(p, "Headline", "auto", [kpis]),
        split(p, "row", {"fr": 1}, [region(p, "Income", {"fr": 3}, [income]), region(p, "Sources", {"fr": 2}, [sources])]),
        split(p, "row", {"fr": 1}, [region(p, "Activity", {"fr": 3}, [activity]), region(p, "This week", {"fr": 2}, [week])]),
    ])
    pages.append(page("hd-dashboard", "Dashboard", layout, route="/", placement=placed))

    # Events list -----------------------------------------------------------
    p = P("hd-events")
    events = cmp(p, "list", "Events", "table", "vertical", [
        header("Events"),
        el("search", "Search events"),
        filt("Status", dataset=DS_EVENT_STATUS, selected="Published"),
        filt("Category", dataset=DS_EVENT_CATEGORY),
        el("column-header"),
        el("select-column"),
        col("Event", "text", "Summer Regatta Dinner, Family Beach Clean, Sailing Taster Day, Harbour History Talk, Volunteer Induction, Autumn Quiz Night, Christmas Hamper Appeal launch, Winter Warmer Lunch"),
        col("Date", "date", "18 Jul 2026, 26 Jul 2026, 8 Aug 2026, 20 Aug 2026, 5 Sep 2026, 2 Oct 2026, 7 Nov 2026, 12 Dec 2026"),
        col("Category", "status", dataset=DS_EVENT_CATEGORY),
        col("Status", "status", dataset=DS_EVENT_STATUS),
        col("Booked / capacity", "text", "168 / 180, 40 / 80, 24 / 24, 55 / 80, 15 / 30, 96 / 120, 0 / 200, 12 / 60"),
        col("Income", "currency", "£5880, £0, £240, £275, £0, £768, £0, £96"),
        el("row-action", "Open", link="hd-event-bookings"),
        el("row-action", "Edit", link="hd-event-edit", fill="ghost"),
        el("pagination", "", pageSize="25"),
    ], rows=8, id="c-hd-events-table")
    pages.append(page("hd-events", "Events", region(p, "Events", {"fr": 1}, [events]), route="/events", placement=placed))

    # Event detail (a shell for its own tabs) ------------------------------
    p = P("hd-event")
    head = canvas(p, "Event header", stack([
        el("badge", "Published", shape="pill"),
        el("heading", "Summer Regatta Dinner"),
        el("text", "Saturday 18 July 2026 · 19:00 · Harbourside Sailing Club · 168 of 180 places booked"),
    ], x=24, y=20, gap=6) + row([btn("Edit", "hd-event-edit", style="secondary", fill="outline"), btn("Message attendees", style="secondary", fill="outline"), btn("Cancel event", style="danger", fill="ghost")], y=140, x=24, step=190), height=200, shape="transparent", id="c-hd-event-head")
    tabs = cmp(p, "navbar", "Event tabs", "tabs", "horizontal", [
        nav("Bookings", "hd-event-bookings"), nav("Check-in", "hd-event-checkin"), nav("Waiting list", "hd-event-bookings"), nav("Finance", "hd-event-bookings"),
    ])
    layout = split(p, "col", {"fr": 1}, [
        region(p, "Header", "auto", [head]),
        region(p, "Tabs", "auto", [tabs]),
        region(p, "Content", {"fr": 1}, [], id=HD_EVENT_CONTENT),
    ])
    pages.append(page("hd-event", "Event detail", layout, route="/events/summer-regatta-dinner", placement=placed))

    p = P("hd-event-bookings")
    figures = cmp(p, "graph", "Booking figures", "stats", "horizontal", [
        stat("Confirmed", "168", "12 places left"), stat("Waiting list", "9", "2 offered today"), stat("Checked in", "0", "doors open 18:30"), stat("Ticket income", "£5,880", "+£420 this week"),
    ])
    bookings = cmp(p, "list", "Bookings", "table", "vertical", [
        header("Bookings"),
        el("search", "Search bookings"),
        filt("Status", dataset=DS_BOOKING_STATUS),
        el("column-header"),
        el("select-column"),
        col("Name", "person", "Priya Nair, Colin Marsh, Ruth Adeyemi, Sam Okoro, Farida Hussain, Tom Reeves"),
        col("Email", "email"),
        col("Tickets", "number", "2, 10, 1, 2, 4, 2"),
        col("Amount", "currency", "£70, £300, £35, £50, £140, £70"),
        col("Status", "status", dataset=DS_BOOKING_STATUS),
        col("Booked", "date", "3 Jul, 28 Jun, 20 Jun, 14 Jun, 9 Jun, 2 Jun"),
        el("row-action", "Check in"),
        el("row-action", "Refund", fill="ghost"),
        el("pagination", "", pageSize="25"),
    ], rows=6)
    pages.append(page("hd-event-bookings", "Event > Bookings", region(p, "Bookings", {"fr": 1}, [figures, bookings]), placement=("hd-event", HD_EVENT_CONTENT)))

    p = P("hd-event-checkin")
    checkin = cmp(p, "list", "Check-in", "rows", "vertical", [
        header("Check attendees in"),
        el("search", "Type a surname or scan a ticket", shape="pill", id="e-hd-checkin-search"),
        col("Name", "person", "Priya Nair, Colin Marsh, Ruth Adeyemi, Sam Okoro, Farida Hussain"),
        col("Tickets", "number", "2, 10, 1, 2, 4"),
        col("Status", "status", dataset=DS_BOOKING_STATUS),
        el("row-action", "Check in"),
    ], rows=5, id="c-hd-checkin-list")
    door = text_block(p, "On the door", [
        el("heading", "On the door"),
        el("label", "Checked in"), el("text", "0 of 168"),
        el("label", "Walk-ups"), el("text", "0"),
        el("divider"),
        el("button", "Sell a walk-up ticket", link="hd-event-new", style="primary"),
        el("button", "Scan QR codes", style="secondary", fill="outline"),
    ], shape="card", wrap_at=40)
    layout = split(p, "row", {"fr": 1}, [region(p, "Attendees", {"fr": 3}, [checkin]), region(p, "On the door", {"fr": 1}, [door])])
    pages.append(page("hd-event-checkin", "Event > Check-in", layout, placement=("hd-event", HD_EVENT_CONTENT)))

    p = P("hd-event-new")
    pages.append(page("hd-event-new", "New event", region(p, "New event", {"fr": 1}, [event_form(p, "New event", "hd-event-bookings")]), presentation="drawer"))
    p = P("hd-event-edit")
    pages.append(page("hd-event-edit", "Edit event", region(p, "Edit event", {"fr": 1}, [event_form(p, "Edit event", BACK)]), presentation="drawer"))

    # Donations -------------------------------------------------------------
    p = P("hd-donations")
    figures = cmp(p, "graph", "Donations this month", "stats", "horizontal", [
        stat("This month", "£18,420", "+12%"), stat("Regular gifts", "£4,680", "312 givers"),
        stat("One-off", "£13,740", "84 gifts"), stat("Failed payments", "7", "needs attention"),
    ])
    table = cmp(p, "list", "Donations", "table", "vertical", [
        header("Donations"),
        el("search", "Search by donor or reference"),
        filt("Type", dataset=DS_DONATION_TYPE),
        filt("Gift Aid", dataset=DS_GIFT_AID),
        filt("Method", dataset=DS_PAYMENT_METHOD),
        el("column-header"),
        el("select-column"),
        col("Date", "date", "28 Sep 2026, 28 Sep 2026, 27 Sep 2026, 26 Sep 2026, 25 Sep 2026, 25 Sep 2026, 24 Sep 2026, 22 Sep 2026"),
        col("Donor", "person", "Tom Reeves, Anonymous, Ruth Adeyemi, Westbay Rotary Club, Priya Nair, Colin Marsh, Farida Hussain, Sam Okoro"),
        col("Amount", "currency", "£15, £50, £25, £500, £10, £200, £25, £15"),
        col("Type", "text", dataset=DS_DONATION_TYPE),
        col("Method", "text", dataset=DS_PAYMENT_METHOD),
        col("Gift Aid", "status", dataset=DS_GIFT_AID),
        col("Campaign", "text", "Regular giving, Bursary appeal, Regular giving, Regatta dinner, Bursary appeal, General, Regular giving, Regular giving"),
        el("row-action", "Open", link="hd-donation"),
        el("pagination", "", pageSize="25"),
    ], rows=8, id="c-hd-donations-table")
    pages.append(page("hd-donations", "Donations", region(p, "Donations", {"fr": 1}, [figures, table]), route="/donations", placement=placed))

    p = P("hd-donation")
    detail = canvas(p, "Donation", stack([
        el("heading", "£200.00 from Colin Marsh"),
        el("badge", "Gift Aid declared", shape="pill"),
        el("label", "Date"), el("text", "25 September 2026"),
        el("label", "Method"), el("text", "Cheque, banked 26 September"),
        el("label", "Type"), el("text", "One-off · General fund"),
        el("label", "Reference"), el("text", "DON-2026-01184"),
        el("label", "Recorded by"), el("text", "Margaret Okafor"),
    ], x=24, y=20, gap=6) + row([btn("Send receipt"), btn("Edit", "hd-donation-new", style="secondary", fill="outline"), btn("Refund", style="danger", fill="ghost")], y=400, x=24, step=150), height=460, shape="transparent")
    history = cmp(p, "list", "History", "feed", "vertical", [
        header("History", "above"),
        col("Event", "text", "Receipt emailed, Gift Aid declaration matched, Donation recorded"),
        col("When", "time", "26 Sep 10:14, 25 Sep 16:02, 25 Sep 15:58"),
        col("By", "person", "System, Margaret Okafor, Margaret Okafor"),
    ], rows=3)
    pages.append(page("hd-donation", "Donation detail", region(p, "Donation", {"fr": 1}, [detail, history]), presentation="drawer"))

    p = P("hd-donation-new")
    pages.append(page("hd-donation-new", "Record offline donation", region(p, "Record donation", {"fr": 1}, [
        cmp(p, "form", "Record an offline donation", "simple", "one-column", [
            header("Record an offline donation"),
            sel("Donor", options="Search supporters…, Add a new supporter, Anonymous", selected="Search supporters…"),
            inp("Amount (£)", "number", "0.00"),
            el("date-picker", "Date received"),
            sel("Method", dataset=DS_PAYMENT_METHOD, selected="Cheque"),
            sel("Type", dataset=DS_DONATION_TYPE, selected="One-off"),
            sel("Campaign", options="General, Bursary appeal, Christmas Hamper Appeal", selected="General"),
            el("checkbox", "A Gift Aid declaration is held for this donor"),
            inp("Reference", placeholder="Cheque number or paying-in slip"),
            el("text-area", "Notes"),
            btn("Cancel", BACK, style="secondary"), btn("Save donation", "hd-donations"),
        ], id="c-hd-donation-form"),
    ]), presentation="modal"))

    # Gift Aid --------------------------------------------------------------
    p = P("hd-giftaid")
    figures = cmp(p, "graph", "Gift Aid position", "stats", "horizontal", [
        stat("Unclaimed", "£4,115", "on £16,460 of gifts"), stat("Declarations on file", "1,204", "+38 this quarter"),
        stat("Last claim", "£9,860", "paid 3 Jul 2026"), stat("Claimed this year", "£31,240", "3 claims paid"),
    ], id="c-hd-giftaid-kpis")
    prepare = cmp(p, "form", "Prepare a claim", "inline", "horizontal", [
        header("Prepare a claim"),
        el("date-picker", "From"), el("date-picker", "To"),
        btn("Prepare claim", "hd-giftaid-claim"),
    ])
    claims = cmp(p, "list", "Claims", "table", "vertical", [
        header("Claims"),
        el("column-header"),
        col("Period", "text", "Jul to Sep 2026, Apr to Jun 2026, Jan to Mar 2026, Oct to Dec 2025"),
        col("Donations", "number", "412, 388, 351, 402"),
        col("Gifts", "currency", "£16460, £39440, £34200, £41900"),
        col("Gift Aid", "currency", "£4115, £9860, £8550, £10475"),
        col("Status", "status", "Draft, Paid, Paid, Paid"),
        col("Submitted", "date", "—, 20 Jun 2026, 22 Mar 2026, 19 Dec 2025"),
        el("row-action", "Open", link="hd-giftaid-claim"),
    ], rows=4)
    pages.append(page("hd-giftaid", "Gift Aid claims", region(p, "Gift Aid", {"fr": 1}, [figures, prepare, claims]), route="/gift-aid", placement=placed))

    p = P("hd-giftaid-claim")
    summary = canvas(p, "Claim summary", stack([
        el("heading", "Gift Aid claim · July to September 2026"),
        el("badge", "Draft", shape="pill"),
        el("text", "412 donations from 296 donors with a declaration on file. 38 donations excluded: no declaration, or the donor is not a UK taxpayer."),
        el("label", "Claim value"), el("text", "£4,115.00 on gifts of £16,460.00"),
    ], x=24, y=20, gap=6) + row([btn("Export HMRC schedule"), btn("Mark as submitted", style="secondary", fill="outline"), btn("Send to treasurer for approval", style="secondary", fill="outline")], y=230, x=24, step=210), height=290, shape="transparent")
    included = cmp(p, "list", "Donations in this claim", "table", "vertical", [
        header("Donations in this claim"),
        el("search", "Search donors"),
        filt("Include", options="Included, Excluded, All", selected="Included"),
        el("column-header"),
        col("Donor", "person", "Tom Reeves, Ruth Adeyemi, Priya Nair, Colin Marsh, Farida Hussain"),
        col("Address", "text", "14 Quay Cottages HB1 3DR, 2 Mariners Way HB2 1AA, 8 Beacon Rise HB1 5EF, Chandlery House HB1 2QZ, 31 Fore Street HB2 4LP"),
        col("Amount", "currency", "£15, £25, £10, £200, £25"),
        col("Gift Aid", "currency", "£3.75, £6.25, £2.50, £50.00, £6.25"),
        col("Declaration", "status", dataset=DS_GIFT_AID),
        el("row-action", "Exclude", fill="ghost"),
        el("pagination", "", pageSize="50"),
    ], rows=5)
    pages.append(page("hd-giftaid-claim", "Gift Aid claim", region(p, "Claim", {"fr": 1}, [summary, included]), presentation="drawer"))

    # Supporters ------------------------------------------------------------
    p = P("hd-supporters")
    table = cmp(p, "list", "Supporters", "table", "vertical", [
        header("Supporters"),
        el("search", "Search by name, email or postcode"),
        filt("Type", options="Any, Donor, Attendee, Volunteer, Trustee", selected="Any"),
        filt("Gift Aid", dataset=DS_GIFT_AID),
        filt("Consent", options="Any, Email, Post, None", selected="Any"),
        el("column-header"),
        el("select-column"),
        col("Name", "person", "Tom Reeves, Priya Nair, Ruth Adeyemi, Colin Marsh, Farida Hussain, Sam Okoro, Westbay Rotary Club, Amira Shah"),
        col("Email", "email"),
        col("Type", "tags", "Donor, Attendee, Trustee, Donor, Trustee, Volunteer, Donor, Volunteer"),
        col("Total given", "currency", "£1260, £80, £425, £2100, £310, £45, £3500, £0"),
        col("Last gift", "date", "28 Sep 2026, 25 Sep 2026, 27 Sep 2026, 25 Sep 2026, 24 Sep 2026, 22 Sep 2026, 26 Sep 2026, —"),
        col("Gift Aid", "status", dataset=DS_GIFT_AID),
        col("Email consent", "boolean", "Yes, Yes, Yes, No, Yes, Yes, No, Yes"),
        el("row-action", "Open", link="hd-supporter-giving"),
        el("pagination", "", pageSize="50"),
    ], rows=8)
    pages.append(page("hd-supporters", "Supporters", region(p, "Supporters", {"fr": 1}, [table]), route="/supporters", placement=placed))

    p = P("hd-supporter")
    head = canvas(p, "Supporter header", stack([
        el("heading", "Tom Reeves"),
        el("badge", "Regular giver since 2019", shape="pill"),
        el("text", "tom@example.org · 07700 900456 · 14 Quay Cottages, Harbourside HB1 3DR"),
    ], x=24, y=20, gap=6) + row([btn("Edit", "hd-supporter-edit", style="secondary", fill="outline"), btn("Add a note", style="secondary", fill="outline"), btn("Record donation", "hd-donation-new")], y=140, x=24, step=170), height=200, shape="transparent")
    tabs = cmp(p, "navbar", "Supporter tabs", "tabs", "horizontal", [
        nav("Giving", "hd-supporter-giving"), nav("Events", "hd-supporter-giving"), nav("Volunteering", "hd-supporter-giving"), nav("Communications", "hd-supporter-giving"),
    ])
    layout = split(p, "col", {"fr": 1}, [
        region(p, "Header", "auto", [head]), region(p, "Tabs", "auto", [tabs]), region(p, "Content", {"fr": 1}, [], id=HD_SUPPORTER_CONTENT),
    ])
    pages.append(page("hd-supporter", "Supporter detail", layout, route="/supporters/tom-reeves", placement=placed))

    p = P("hd-supporter-giving")
    figures = cmp(p, "graph", "Giving summary", "stats", "horizontal", [
        stat("Lifetime", "£1,260", "since 2019"), stat("Monthly gift", "£15", "since Mar 2019"), stat("Gift Aid", "Declared", "12 Mar 2019"), stat("Last receipt", "28 Sep 2026", "emailed"),
    ])
    trend = cmp(p, "graph", "Giving over time", "line", "vertical", [
        header("Giving over time"),
        el("series", "Gifts", values="180, 180, 180, 240, 240, 240"),
        el("category-axis", "", categories="2021, 2022, 2023, 2024, 2025, 2026"),
        el("value-axis", "£", unit="£"),
    ])
    gifts = cmp(p, "list", "Donations", "table", "vertical", [
        header("Donations"),
        el("column-header"),
        col("Date", "date", "28 Sep 2026, 28 Aug 2026, 28 Jul 2026, 18 Jul 2026, 28 Jun 2026"),
        col("Amount", "currency", "£15, £15, £15, £70, £15"),
        col("Type", "text", dataset=DS_DONATION_TYPE),
        col("Method", "text", dataset=DS_PAYMENT_METHOD),
        col("Gift Aid", "status", dataset=DS_GIFT_AID),
        el("row-action", "Open", link="hd-donation"),
    ], rows=5)
    layout = split(p, "col", {"fr": 1}, [region(p, "Summary", "auto", [figures]), split(p, "row", {"fr": 1}, [region(p, "Trend", {"fr": 2}, [trend]), region(p, "Gifts", {"fr": 3}, [gifts])])])
    pages.append(page("hd-supporter-giving", "Supporter > Giving", layout, placement=("hd-supporter", HD_SUPPORTER_CONTENT)))

    p = P("hd-supporter-edit")
    pages.append(page("hd-supporter-edit", "Edit supporter", region(p, "Edit supporter", {"fr": 1}, [
        cmp(p, "form", "Edit supporter", "sections", "one-column", [
            header("Edit supporter"),
            el("section-heading", "Contact"),
            inp("Full name", placeholder="Tom Reeves"), inp("Email", "email"), inp("Mobile", "phone"),
            inp("Address"), inp("Postcode"),
            el("section-heading", "Gift Aid"),
            sel("Declaration", dataset=DS_GIFT_AID, selected="Declared"),
            el("date-picker", "Declaration date"),
            el("section-heading", "Consent"),
            el("toggle", "Email"), el("toggle", "Post"), el("toggle", "Telephone"),
            el("help-text", "Consent changes are logged with the date and the person who made them."),
            btn("Cancel", BACK, style="secondary"), btn("Save", BACK),
        ]),
    ]), presentation="drawer"))

    # Volunteers and rota ---------------------------------------------------
    p = P("hd-volunteers")
    table = cmp(p, "list", "Volunteers", "table", "vertical", [
        header("Volunteers"),
        el("search", "Search volunteers"),
        filt("Role", dataset=DS_VOLUNTEER_ROLE),
        filt("Status", options="Active, On a break, Left", selected="Active"),
        el("column-header"),
        col("Name", "person", "Sam Okoro, Amira Shah, Ben Carter, Lydia Frost, Owen Price, Hana Sato"),
        col("Roles", "tags", "Steward, Kitchen, Driver, First aider, Steward, Admin"),
        col("Phone", "phone"),
        col("DBS expires", "date", "12 Mar 2027, 4 Nov 2026, 30 Sep 2026, 15 Jan 2028, —, 9 Jun 2027"),
        col("Last shift", "date", "22 Sep 2026, 20 Sep 2026, 15 Sep 2026, 18 Jul 2026, 1 Sep 2026, 25 Sep 2026"),
        col("Hours this year", "number", "84, 120, 36, 12, 48, 60"),
        el("row-action", "Open"),
        el("row-action", "Add to rota", link="hd-rota", fill="ghost"),
        el("pagination", "", pageSize="25"),
    ], rows=6)
    pages.append(page("hd-volunteers", "Volunteers", region(p, "Volunteers", {"fr": 1}, [table]), route="/volunteers", placement=placed))

    p = P("hd-rota")
    rota = cmp(p, "calendar", "Volunteer rota", "week", "full", [
        header("Volunteer rota"),
        el("calendar-nav", ""),
        el("view-switcher", "", views="Week, Day, Month"),
        el("event", "Food bank · Sam Okoro (steward)", when="Tue 09:00", kind="task"),
        el("event", "Food bank · Amira Shah (kitchen)", when="Tue 09:00", kind="task"),
        el("event", "Food bank · Ben Carter (driver)", when="Tue 08:30", kind="task"),
        el("event", "Sailing training · Owen Price", when="Thu 18:30", kind="meeting"),
        el("event", "Quiz night · 4 stewards needed", when="Fri 18:00", kind="reminder"),
        el("event", "Befriending visits · Lydia Frost", when="Wed", kind="all-day"),
        el("calendar-legend", "", kinds="Food bank, Sailing, Fundraiser"),
    ], size="fill")
    pages.append(page("hd-rota", "Rota", region(p, "Rota", {"fr": 1}, [rota]), route="/rota", placement=placed))

    # Reports ---------------------------------------------------------------
    p = P("hd-reports")
    trend = cmp(p, "graph", "Income against last year", "line", "vertical", [
        header("Income against last year"),
        el("series", "2026/27", values="11000, 14600, 19800, 17700, 13000, 21020"),
        el("series", "2025/26", values="9800, 12100, 17400, 15200, 11900, 16800"),
        el("category-axis", "", categories="Apr, May, Jun, Jul, Aug, Sep"),
        el("value-axis", "£", unit="£"),
        el("legend", ""),
        el("range-selector", "Financial year to date"),
    ])
    funds = cmp(p, "graph", "Restricted and unrestricted funds", "donut", "vertical", [
        header("Funds"),
        el("series", "Share of funds", values="62, 21, 17"),
        el("category-axis", "", categories="Unrestricted, Restricted: bursary, Restricted: food bank"),
    ])
    library = cmp(p, "list", "Report library", "table", "vertical", [
        header("Report library"),
        el("column-header"),
        col("Report", "text", "Trustee finance pack, Gift Aid reconciliation, Donor retention, Event profitability, Volunteer hours, Consent audit"),
        col("Last run", "date", "1 Sep 2026, 3 Jul 2026, 1 Sep 2026, 20 Jul 2026, 1 Sep 2026, 15 Aug 2026"),
        col("Format", "tags", "PDF, CSV, PDF, PDF, CSV, CSV"),
        el("row-action", "Run"),
        el("row-action", "Schedule", fill="ghost"),
    ], rows=6)
    layout = split(p, "col", {"fr": 1}, [region(p, "Trend", {"fr": 1}, [trend]), split(p, "row", {"fr": 1}, [region(p, "Funds", {"fr": 2}, [funds]), region(p, "Library", {"fr": 3}, [library])])])
    pages.append(page("hd-reports", "Reports", layout, route="/reports", placement=placed))

    # Settings --------------------------------------------------------------
    p = P("hd-settings")
    org = cmp(p, "form", "Organisation settings", "sections", "two-column", [
        header("Settings"),
        el("section-heading", "Organisation"),
        inp("Charity name", placeholder="Harbourside Community Trust"), inp("Registered charity number", placeholder="1123456"),
        inp("HMRC charities reference", placeholder="XR12345"), inp("Financial year starts", placeholder="1 April"),
        el("section-heading", "Payments"),
        inp("Stripe account", placeholder="acct_…"), el("toggle", "Test mode"),
        el("section-heading", "Email"),
        inp("Sender name", placeholder="Harbourside Community Trust"), inp("Sender address", "email", "hello@harboursidetrust.example.org"),
        el("section-heading", "Receipts"),
        el("toggle", "Send a receipt for every online donation"), el("toggle", "Send an annual giving statement in April"),
        btn("Save settings"),
    ])
    users = cmp(p, "list", "Staff users", "table", "vertical", [
        header("Staff users"),
        el("column-header"),
        col("Name", "person", "Margaret Okafor, Dev Patel, Sophie Lambert, Alan Whitfield"),
        col("Role", "text", "Administrator, Fundraising, Volunteering, Trustee (read only)"),
        col("Last signed in", "date", "Today, Today, Yesterday, 12 Sep 2026"),
        el("row-action", "Edit"),
        el("row-action", "Remove", fill="ghost"),
    ], rows=4)
    pages.append(page("hd-settings", "Settings", region(p, "Settings", {"fr": 1}, [org, users]), route="/settings", placement=placed))

    # Shell -----------------------------------------------------------------
    p = P("hd-shell")
    rail = cmp(p, "navbar", "Side navigation", "grouped", "vertical", [
        el("brand", "Harbourside Hub", link="hd-dashboard", logo="wave"),
        el("group-heading", "Overview"), nav("Dashboard", "hd-dashboard"),
        el("group-heading", "Events"), nav("Events", "hd-events"), nav("Bookings", "hd-event-bookings"), nav("Check-in", "hd-event-checkin"),
        el("group-heading", "Fundraising"), nav("Donations", "hd-donations"), nav("Gift Aid claims", "hd-giftaid"), nav("Supporters", "hd-supporters"),
        el("group-heading", "People"), nav("Volunteers", "hd-volunteers"), nav("Rota", "hd-rota"),
        el("group-heading", "Admin"), nav("Reports", "hd-reports"), nav("Settings", "hd-settings"),
        el("divider"),
        el("avatar", "MO", name="Margaret Okafor", role="Operations Manager"),
    ], id="c-hd-shell-rail")
    top = cmp(p, "navbar", "Top bar", "plain", "horizontal", [
        el("search", "Search", shape="pill"),
        btn("Record donation", "hd-donation-new", style="secondary", fill="outline"),
        btn("New event", "hd-event-new"),
    ], id="c-hd-shell-top")
    layout = split(p, "row", {"fr": 1}, [
        region(p, "Nav", 240, [rail]),
        split(p, "col", {"fr": 1}, [region(p, "Header", "auto", [top]), region(p, "Content", {"fr": 1}, [], id=HD_SHELL_CONTENT)]),
    ])
    pages.append(page(HD_SHELL, "App shell", layout, route="/"))

    return {
        "name": "Hub app (desktop)",
        "interfaceType": "desktop",
        "landingPageId": "hd-dashboard",
        "personas": ["Margaret Okafor", "Dev Patel", "Alan Whitfield"],
        "userTypes": ["Operations Manager", "Fundraising Lead", "Volunteer Coordinator", "Trustee"],
        "pages": pages,
    }


# ── Hub app (mobile) ─────────────────────────────────────────────────────

HM_SHELL = "hm-shell"
HM_SHELL_CONTENT = "r-hm-shell-content"

#: Element data the bundle validator does not accept but the editor stores:
#: ``data.icon`` on a nav item in an Icons-shaped bar, and ``data.align`` for
#: which zone of a horizontal bar an element sits in. Applied after import
#: through the ops endpoint, the way the Inspector does it. Keyed by
#: (wireframe name, page name, component id), then element label.
POLISH: list[tuple[str, str, str, dict[str, dict[str, str]]]] = [
    ("Hub app (mobile)", "App shell", "c-hm-shell-tabs", {
        "Today": {"icon": "home", "align": "centre"},
        "Check-in": {"icon": "clipboard", "align": "centre"},
        "Events": {"icon": "calendar", "align": "centre"},
        "More": {"icon": "settings", "align": "centre"},
    }),
    # Brand left, links centred, Donate right: the left and right zones of a
    # horizontal bar share its width equally, so a long link run beside the
    # brand is clipped on a narrow desktop.
    ("Brochure site (desktop)", "Site shell", "c-bd-shell-nav", {
        label: {"align": "centre"} for label in ("Home", "About", "What's on", "News", "Volunteer")
    }),
    # A search box trails by default; moving it left leaves the right zone
    # to the two action buttons.
    ("Hub app (desktop)", "App shell", "c-hd-shell-top", {"Search": {"align": "left"}}),
]


def hub_mobile() -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    placed = (HM_SHELL, HM_SHELL_CONTENT)
    W = 40

    p = P("hm-today")
    figures = cmp(p, "graph", "Today", "stats", "horizontal", [
        stat("Checked in", "86 / 168", "doors open 18:30"), stat("Volunteers on shift", "9", "of 11 rostered"),
    ])
    today = cmp(p, "list", "Today's events", "rows", "vertical", [
        header("Today", "above"),
        col("Event", "text", "Tuesday food bank session, Sailing club training"),
        col("When", "time", "09:00, 18:30"),
        el("row-action", "Open", link="hm-event"),
    ], rows=2)
    latest = cmp(p, "list", "Latest donations", "feed", "vertical", [
        header("Latest donations", "above"),
        col("Gift", "text", "£15 monthly gift, £50 to the bursary appeal, £200 cheque banked"),
        col("When", "time", "2 min ago, 14 min ago, 3 hr ago"),
        col("From", "person", "Tom Reeves, Anonymous, Colin Marsh"),
    ], rows=3)
    pages.append(page("hm-today", "Today", region(p, "Today", {"fr": 1}, [figures, today, latest]), route="/", placement=placed))

    p = P("hm-checkin")
    scan = canvas(p, "Scan", row([btn("Scan a ticket QR code", "hm-checkin"), ], y=16, x=20), height=80, shape="transparent")
    lst = cmp(p, "list", "Check-in", "rows", "vertical", [
        header("Check in · Summer Regatta Dinner"),
        el("search", "Surname", shape="pill"),
        col("Name", "person", "Priya Nair, Colin Marsh, Ruth Adeyemi, Sam Okoro, Farida Hussain, Tom Reeves"),
        col("Tickets", "number", "2, 10, 1, 2, 4, 2"),
        col("Status", "status", dataset=DS_BOOKING_STATUS),
        el("row-action", "Check in"),
    ], rows=6, id="c-hm-checkin-list")
    pages.append(page("hm-checkin", "Check-in", region(p, "Check-in", {"fr": 1}, [scan, lst]), route="/check-in", placement=placed))

    p = P("hm-events")
    pages.append(page("hm-events", "Events", region(p, "Events", {"fr": 1}, [
        cmp(p, "list", "Events", "cards", "vertical", [
            header("Events"),
            filt("Status", dataset=DS_EVENT_STATUS, selected="Published"),
            col("Event", "text", "Autumn Quiz Night, Christmas Hamper Appeal launch, Winter Warmer Lunch"),
            col("When", "date", "Fri 2 Oct 19:00, Sat 7 Nov 10:00, Sat 12 Dec 12:30"),
            col("Status", "status", dataset=DS_EVENT_STATUS),
            col("Booked", "text", "96 of 120, 0 of 200, 12 of 60"),
            el("row-action", "Open", link="hm-event"),
        ], rows=3),
    ]), route="/events", placement=placed))

    p = P("hm-event")
    detail = canvas(p, "Event", stack([
        el("badge", "Published", shape="pill"),
        el("heading", "Autumn Quiz Night"),
        el("text", "Fri 2 October 2026 · 19:00 · The Old Boathouse"),
        el("label", "Booked"), el("text", "96 of 120 · £768 income"),
    ], x=20, y=20, gap=6, wrap_at=W) + [
        *row([btn("Check in attendees", "hm-checkin")], y=210, x=20),
        *row([btn("Bookings", "hm-bookings", style="secondary", fill="outline"), btn("Edit", style="secondary", fill="ghost")], y=266, x=20, step=130),
    ], height=330, shape="card")
    pages.append(page("hm-event", "Event", region(p, "Event", {"fr": 1}, [detail]), route="/events/autumn-quiz-night", placement=placed))

    p = P("hm-bookings")
    pages.append(page("hm-bookings", "Bookings", region(p, "Bookings", {"fr": 1}, [
        cmp(p, "list", "Bookings", "rows", "vertical", [
            header("Bookings"),
            el("search", "Search"),
            col("Name", "person", "Priya Nair, Colin Marsh, Ruth Adeyemi, Sam Okoro, Farida Hussain"),
            col("Tickets", "number", "2, 10, 1, 2, 4"),
            col("Status", "status", dataset=DS_BOOKING_STATUS),
        ], rows=5),
    ]), route="/events/autumn-quiz-night/bookings", placement=placed))

    p = P("hm-donate")
    pages.append(page("hm-donate", "Record donation", region(p, "Record donation", {"fr": 1}, [
        cmp(p, "form", "Record a donation", "simple", "one-column", [
            header("Record a donation"),
            sel("Donor", options="Search supporters…, Anonymous", selected="Search supporters…"),
            inp("Amount (£)", "number", "0.00"),
            sel("Method", dataset=DS_PAYMENT_METHOD, selected="Cash"),
            el("checkbox", "Gift Aid declaration held"),
            inp("Reference"),
            btn("Save", "hm-today"),
        ], id="c-hm-donate-form"),
    ]), route="/donations/new", placement=placed))

    p = P("hm-rota")
    pages.append(page("hm-rota", "Rota", region(p, "Rota", {"fr": 1}, [
        cmp(p, "calendar", "My shifts", "day", "compact", [
            header("This week's shifts"),
            el("calendar-nav", ""),
            el("event", "Food bank · steward", when="Tue 09:00", kind="task"),
            el("event", "Sailing training · driver", when="Thu 18:00", kind="task"),
            el("event", "Quiz night · 4 stewards needed", when="Fri 18:00", kind="reminder"),
        ], size="fill"),
    ]), route="/rota", placement=placed))

    p = P("hm-volunteers")
    pages.append(page("hm-volunteers", "Volunteers", region(p, "Volunteers", {"fr": 1}, [
        cmp(p, "list", "Volunteers", "rows", "vertical", [
            header("Volunteers"),
            el("search", "Search"),
            col("Name", "person", "Sam Okoro, Amira Shah, Ben Carter, Lydia Frost, Owen Price"),
            col("Role", "text", dataset=DS_VOLUNTEER_ROLE),
            col("Phone", "phone"),
            el("row-action", "Call"),
        ], rows=5),
    ]), route="/volunteers", placement=placed))

    p = P("hm-more")
    pages.append(page("hm-more", "More", region(p, "More", {"fr": 1}, [
        cmp(p, "navbar", "More", "plain", "vertical", [
            el("avatar", "SL", name="Sophie Lambert", role="Volunteer Coordinator"),
            el("divider"),
            nav("Record a donation", "hm-donate"), nav("Volunteers", "hm-volunteers"), nav("Rota", "hm-rota"), nav("Bookings", "hm-bookings"),
            el("divider"),
            nav("Settings"), nav("Sign out"),
        ]),
    ]), route="/more", placement=placed))

    p = P("hm-shell")
    top = cmp(p, "navbar", "Top bar", "plain", "horizontal", [
        el("brand", "Hub", logo="wave"),
        el("avatar", "SL", name="Sophie Lambert", role="Volunteer Coordinator"),
    ])
    tabs = cmp(p, "navbar", "Tab bar", "icons", "horizontal", [
        nav("Today", "hm-today"), nav("Check-in", "hm-checkin"), nav("Events", "hm-events"), nav("More", "hm-more"),
    ], id="c-hm-shell-tabs")
    layout = split(p, "col", {"fr": 1}, [
        region(p, "Nav", "auto", [top]),
        region(p, "Content", {"fr": 1}, [], id=HM_SHELL_CONTENT),
        region(p, "Tabs", "auto", [tabs]),
    ])
    pages.append(page(HM_SHELL, "App shell", layout, route="/"))

    return {
        "name": "Hub app (mobile)",
        "interfaceType": "mobile",
        "landingPageId": "hm-today",
        "personas": ["Sophie Lambert", "Margaret Okafor"],
        "userTypes": ["Volunteer Coordinator", "Operations Manager"],
        "pages": pages,
    }


# ── Archived concept ─────────────────────────────────────────────────────


def kiosk_concept() -> dict[str, Any]:
    p = P("kiosk-home")
    screen = canvas(p, "Kiosk", stack([
        el("heading", "Tap to give"),
        el("text", "Every pound feeds the harbour community. Tap an amount, then tap your card."),
    ], x=48, y=48, gap=12) + row([btn("£5"), btn("£10"), btn("£20"), btn("Other", style="secondary", fill="outline")], y=180, x=48, step=140)
        + row([el("text", "Registered charity 1123456 · Gift Aid it? Ask at the desk.")], y=280, x=48), height=340, shape="card")
    return {
        "name": "Donation kiosk concept",
        "interfaceType": "tablet",
        "landingPageId": "kiosk-home",
        "personas": [],
        "userTypes": ["Donor"],
        "pages": [page("kiosk-home", "Kiosk home", region(p, "Kiosk", {"fr": 1}, [screen]), route="/")],
    }


def all_wireframes() -> list[dict[str, Any]]:
    return [brochure_desktop(), brochure_mobile(), hub_desktop(), hub_mobile(), kiosk_concept()]
