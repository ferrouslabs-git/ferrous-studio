"""Everything about the demo that is not a wireframe or a diagram.

All of it is fiction. Dates are pinned to a project that started in May
2026 and is mid-way through delivery in late September 2026, so the board
reads as a live project rather than a template.
"""
from __future__ import annotations

from typing import Any

ORG_NAME = "Harbourside Community Trust"
PROJECT_NAME = "Harbourside Hub"

PROJECT = {
    "name": PROJECT_NAME,
    "description": (
        "A public brochure website and an internal management application for Harbourside "
        "Community Trust, covering events, bookings, donations, Gift Aid, supporters and volunteers."
    ),
    "rationale": (
        "The trust runs its events, donations, volunteer rota and Gift Aid claims across five "
        "spreadsheets, a paper sign-in sheet and a ten-year-old WordPress site. The two-person office "
        "loses roughly a day a week to double-keying, Gift Aid claims go in late, and supporters cannot "
        "book a place or give online. One system, with a public face and a staff-facing hub, replaces all of it."
    ),
}

PROJECT_DETAILS = {
    "physical_setup": (
        "Two office desktops at the Old Boathouse, a shared iPad on the front desk, and staff phones used "
        "on the door at events where signal is poor. A SumUp card reader for on-the-day payments."
    ),
    "hosting": (
        "Cloud hosted with UK data residency. Managed PostgreSQL with nightly backups retained for 35 days. "
        "The trust owns no servers and has no IT staff, so everything must be managed for them."
    ),
    "latency_goal": (
        "Public pages under two seconds on a 4G connection. Check-in search under half a second for an "
        "event of 400 people, and usable offline at the boathouse door."
    ),
    "accuracy_goal": (
        "Gift Aid claim totals reconcile to the penny against Stripe settlement reports. No donation is "
        "ever counted twice, and every consent change is recorded with its date and author."
    ),
}

ENVIRONMENTS = {
    "uat": "https://uat.harboursidehub.example.org",
    "staging": "https://staging.harboursidehub.example.org",
    "production": "https://www.harboursidetrust.example.org",
}

# ── Personas ─────────────────────────────────────────────────────────────

PERSONAS: list[dict[str, Any]] = [
    {
        "name": "Margaret Okafor", "role": "Operations Manager", "primary_interface": "Desktop",
        "traits": ["Organised", "Cautious with new technology", "Protective of supporters' data", "Twenty years in the charity sector"],
        "jobs_to_be_done": ["Run the weekly food bank session", "Keep the supporter database accurate", "Prepare the quarterly Gift Aid claim", "Report to the trustees each month"],
        "pain_points": ["Retyping bookings from email into spreadsheets", "Not knowing who has paid until the bank statement arrives", "Chasing volunteers by text the night before an event"],
        "feelings": ["Overwhelmed at month end", "Proud of the trust's reputation", "Nervous about getting an HMRC claim wrong"],
        "notes": "The system's primary user. Everything she does today lives in Excel and Outlook; she needs to trust the numbers before she will stop keeping her own copy.",
    },
    {
        "name": "Dev Patel", "role": "Fundraising Lead", "primary_interface": "Desktop",
        "traits": ["Ambitious", "Comfortable with software", "Data-driven", "Works evenings around events"],
        "jobs_to_be_done": ["Grow regular giving", "Launch two appeals a year", "See which events bring in new supporters", "Thank every donor within 48 hours"],
        "pain_points": ["Cannot see donation trends without a pivot table", "Regular gifts lapse silently", "No way to segment supporters for a mailing"],
        "feelings": ["Frustrated by manual reporting", "Motivated by watching totals climb", "Anxious about GDPR consent records"],
        "notes": "Will live in the donations and supporters screens. Wants the dashboard on a screen in the office.",
    },
    {
        "name": "Sophie Lambert", "role": "Volunteer Coordinator", "primary_interface": "Mobile",
        "traits": ["Warm", "Always on the move", "Does everything on her phone", "Part time, three days a week"],
        "jobs_to_be_done": ["Fill the rota for every event", "Check volunteers and attendees in on the day", "Keep DBS and training dates current", "Send the monthly volunteer newsletter"],
        "pain_points": ["The rota lives in a WhatsApp group", "No idea who is coming until they turn up", "Paper sign-in sheets get lost"],
        "feelings": ["Stretched thin", "Loyal to her volunteers", "Relieved when a shift is covered"],
        "notes": "The mobile app is built around her day. She is usually standing up, outdoors, with one hand free.",
    },
    {
        "name": "Tom Reeves", "role": "Regular donor", "primary_interface": "Mobile",
        "traits": ["Retired teacher", "Gives £15 a month", "Reads the newsletter cover to cover", "Values a personal thank-you"],
        "jobs_to_be_done": ["Keep his monthly gift going", "Add Gift Aid to his donations", "Book a table at the regatta dinner", "Update his card when it expires"],
        "pain_points": ["Has to phone the office to change anything", "Never sure whether his Gift Aid declaration is on file", "Receipts arrive weeks later"],
        "feelings": ["Fond of the trust", "Slightly wary of paying online", "Pleased when he sees what his gift did"],
        "notes": "Represents the 300 or so regular givers, most of them over 60. Large type and few steps.",
    },
    {
        "name": "Priya Nair", "role": "Event attendee", "primary_interface": "Mobile",
        "traits": ["Young family", "Found the trust through the youth sailing club", "Books everything on her phone", "Time-poor"],
        "jobs_to_be_done": ["Find family-friendly events", "Book tickets in under two minutes", "Get a reminder the day before", "Show a ticket at the door"],
        "pain_points": ["Event details buried in Facebook posts", "Paying by bank transfer and hoping it arrived", "Turning up to a session that sold out"],
        "feelings": ["Enthusiastic", "Annoyed by clunky forms", "Delighted by a quick confirmation"],
        "notes": "The brochure site's booking flow is measured against her: two minutes from the events list to a ticket.",
    },
    {
        "name": "Alan Whitfield", "role": "Treasurer and trustee", "primary_interface": "Tablet",
        "traits": ["Chartered accountant", "Reads reports on his iPad", "Risk-aware", "Chairs the finance sub-committee"],
        "jobs_to_be_done": ["Sign off the quarterly accounts", "Approve Gift Aid claims before submission", "See restricted against unrestricted income", "Approve the annual budget"],
        "pain_points": ["Figures arrive as screenshots of spreadsheets", "Cannot drill into a total", "Reconciliations take the office a week"],
        "feelings": ["Responsible", "Sceptical of new systems", "Reassured by an audit trail"],
        "notes": "Read-only access, but his approval gates every Gift Aid claim. Wants to see who changed what, and when.",
    },
]

# ── Use case model ───────────────────────────────────────────────────────

ACTORS: list[dict[str, Any]] = [
    {"name": "Supporter", "kind": "person", "description": "Anyone who follows the trust: reads news, subscribes, may go on to give or attend."},
    {"name": "Donor", "kind": "person", "description": "Gives money, once or monthly, online or offline."},
    {"name": "Event attendee", "kind": "person", "description": "Books and attends events; may never donate directly."},
    {"name": "Volunteer", "kind": "person", "description": "Gives time on the rota; some also steward event doors."},
    {"name": "Operations Manager", "kind": "person", "description": "Runs the office: events, donations, Gift Aid and supporter records."},
    {"name": "Fundraising Lead", "kind": "person", "description": "Owns appeals, regular giving and supporter communications."},
    {"name": "Volunteer Coordinator", "kind": "person", "description": "Owns the rota, volunteer records and on-the-day check-in."},
    {"name": "Trustee", "kind": "person", "description": "Reads reports and approves Gift Aid claims. Read-only otherwise."},
    {"name": "Payment provider", "kind": "system", "description": "Stripe: card payments, Direct Debits, settlement reports and webhooks."},
    {"name": "HMRC Charities Online", "kind": "system", "description": "Receives Gift Aid claim schedules and pays claims by BACS."},
    {"name": "Email service", "kind": "system", "description": "Sends receipts, confirmations, reminders and the newsletter."},
    {"name": "Month end", "kind": "time", "description": "Scheduled work that runs on the last day of the month."},
    {"name": "Day before an event", "kind": "time", "description": "Scheduled reminders the day before each event."},
]

USE_CASES: list[dict[str, Any]] = [
    {"name": "Browse what's on", "actors": ["Supporter", "Event attendee"], "description": "Find upcoming events by category and month, on the public site."},
    {"name": "Book event tickets", "actors": ["Event attendee", "Payment provider"], "description": "Choose tickets, pay by card and receive a QR ticket by email."},
    {"name": "Join the waiting list", "actors": ["Event attendee", "Email service"], "description": "Register interest in a sold-out event and be offered a place when one frees up."},
    {"name": "Make a one-off donation", "actors": ["Donor", "Payment provider"], "description": "Give a single gift online, with an optional Gift Aid declaration."},
    {"name": "Set up a regular gift", "actors": ["Donor", "Payment provider"], "description": "Give monthly by Direct Debit or card; change or cancel it later without phoning the office."},
    {"name": "Declare Gift Aid", "actors": ["Donor"], "description": "Make, view or withdraw a Gift Aid declaration."},
    {"name": "Sign up as a volunteer", "actors": ["Volunteer"], "description": "Apply through the public site and be contacted by the coordinator."},
    {"name": "Read news and impact stories", "actors": ["Supporter"], "description": "Stories and figures that show what the trust does with supporters' money."},
    {"name": "Subscribe to the newsletter", "actors": ["Supporter", "Email service"], "description": "Double opt-in email sign-up; consent recorded against the supporter."},
    {"name": "Create and publish an event", "actors": ["Operations Manager"], "description": "Set up an event, its ticket types and capacity, then publish it to the site."},
    {"name": "Manage bookings", "actors": ["Operations Manager"], "description": "See who has booked, refund a booking, move someone off the waiting list."},
    {"name": "Check attendees in", "actors": ["Volunteer Coordinator", "Volunteer"], "description": "On the door, by name search or QR scan, including offline."},
    {"name": "Record an offline donation", "actors": ["Operations Manager"], "description": "Cash, cheques and bank transfers recorded against a supporter with a Gift Aid flag."},
    {"name": "Reconcile payments", "actors": ["Operations Manager", "Payment provider"], "description": "Match Stripe settlements to donations and bookings; flag anything unmatched."},
    {"name": "Prepare and submit a Gift Aid claim", "actors": ["Operations Manager", "Trustee", "HMRC Charities Online"], "description": "Draft a claim for a period, get the treasurer's approval, submit the schedule and record payment."},
    {"name": "Manage supporter records and consent", "actors": ["Operations Manager", "Fundraising Lead"], "description": "One record per person with giving, events and volunteering history, and an auditable consent log."},
    {"name": "Segment supporters and send an appeal", "actors": ["Fundraising Lead", "Email service"], "description": "Build a segment (lapsed givers, attendees who never gave) and send it to the email service."},
    {"name": "Manage the volunteer rota", "actors": ["Volunteer Coordinator"], "description": "Plan shifts per event, fill them, and see who is unconfirmed."},
    {"name": "Send event reminders", "actors": ["Day before an event", "Email service"], "description": "Automatic reminder to every confirmed attendee and rostered volunteer."},
    {"name": "Retry failed regular gifts", "actors": ["Month end", "Payment provider", "Email service"], "description": "Retry failed Direct Debits and let the donor know if a card needs updating."},
    {"name": "View the fundraising dashboard", "actors": ["Fundraising Lead", "Trustee"], "description": "Income by month and source, regular giver count and Gift Aid position."},
    {"name": "Produce the trustee finance pack", "actors": ["Trustee", "Operations Manager"], "description": "Quarterly PDF with restricted and unrestricted funds, ready for the board meeting."},
]

# ── Board ────────────────────────────────────────────────────────────────

RELEASES: dict[str, dict[str, Any]] = {
    "r1": {"title": "Brochure site launch", "status": "DeployedToLive",
           "description": "The public website: home, about, what's on, news, volunteer and contact pages. Replaces the WordPress site."},
    "r2": {"title": "Events and bookings", "status": "DeployedToUAT",
           "description": "Staff create and publish events; supporters book and pay online; volunteers check people in on the door."},
    "r3": {"title": "Donations and Gift Aid", "status": "InProgress",
           "description": "One-off and regular giving with Stripe, receipts, offline donations, and the quarterly Gift Aid claim end to end."},
    "r4": {"title": "Supporters, volunteers and reporting", "status": "NotStarted",
           "description": "The supporter record, consent log, segments, the volunteer rota and the trustee reporting pack."},
}

EPICS: dict[str, dict[str, Any]] = {
    "brochure": {"title": "Brochure website", "release": "r1", "summary": "The public face of the trust: fast, accessible, and a front door to giving, booking and volunteering."},
    "platform": {"title": "Platform, hosting and data migration", "release": "r1", "summary": "UK-hosted environments, deployment pipeline, backups, and moving the spreadsheets into the new database."},
    "events": {"title": "Event management", "release": "r2", "summary": "Staff create, price, publish and cancel events without touching the website."},
    "bookings": {"title": "Online bookings and check-in", "release": "r2", "summary": "Supporters book and pay in two minutes; stewards check them in on the door, even offline."},
    "donations": {"title": "Online donations", "release": "r3", "summary": "One-off and monthly giving through Stripe, receipts within a minute, and offline donations recorded in the same place."},
    "giftaid": {"title": "Gift Aid claims", "release": "r3", "summary": "Declarations captured at the point of giving, claims prepared per quarter, approved by the treasurer and submitted to HMRC."},
    "crm": {"title": "Supporter CRM and consent", "release": "r4", "summary": "One record per person, with an auditable log of every consent change."},
    "volunteers": {"title": "Volunteers and rota", "release": "r4", "summary": "Volunteer profiles with DBS dates, a weekly rota and reminders by SMS."},
    "reporting": {"title": "Reporting and trustee dashboard", "release": "r4", "summary": "The fundraising dashboard for the office and the quarterly finance pack for trustees."},
}

FEATURES: dict[str, tuple[str, str]] = {
    "shell": ("brochure", "Site shell and navigation"),
    "home": ("brochure", "Home and about pages"),
    "evlist": ("brochure", "Public events listing"),
    "news": ("brochure", "News and stories"),
    "contact": ("brochure", "Contact and newsletter sign-up"),
    "hosting": ("platform", "Hosting and deployment pipeline"),
    "migration": ("platform", "Data migration from spreadsheets"),
    "backups": ("platform", "Backups and monitoring"),
    "evcreate": ("events", "Create and edit events"),
    "tickets": ("events", "Ticket types and pricing"),
    "publish": ("events", "Publish, sell out and cancel"),
    "checkout": ("bookings", "Ticket checkout"),
    "confirm": ("bookings", "Booking confirmations and reminders"),
    "waitlist": ("bookings", "Waiting list"),
    "checkin": ("bookings", "On-the-day check-in"),
    "oneoff": ("donations", "One-off and offline donations"),
    "regular": ("donations", "Regular giving"),
    "receipts": ("donations", "Receipts and thank-you emails"),
    "retries": ("donations", "Failed payment retries"),
    "declarations": ("giftaid", "Gift Aid declarations"),
    "claimprep": ("giftaid", "Claim preparation and approval"),
    "hmrc": ("giftaid", "HMRC submission"),
    "records": ("crm", "Supporter records"),
    "consent": ("crm", "Consent and preferences"),
    "segments": ("crm", "Segments and appeals"),
    "profiles": ("volunteers", "Volunteer profiles"),
    "rota": ("volunteers", "Shift rota"),
    "signup": ("volunteers", "Volunteer sign-up"),
    "dashboard": ("reporting", "Fundraising dashboard"),
    "trusteepack": ("reporting", "Trustee finance pack"),
    "exports": ("reporting", "Exports"),
}

SPRINTS: dict[str, dict[str, Any]] = {
    "s1": {"name": "Sprint 1: Foundations", "release": "r1", "start_date": "2026-05-11", "end_date": "2026-05-22", "status": "DeployedToLive", "closed": True,
           "goal": "Environments, pipeline and the site shell. First supporter data migrated."},
    "s2": {"name": "Sprint 2: Brochure pages", "release": "r1", "start_date": "2026-05-25", "end_date": "2026-06-05", "status": "DeployedToLive", "closed": True,
           "goal": "Every public page built and reviewed with Margaret and Dev."},
    "s3": {"name": "Sprint 3: Launch", "release": "r1", "start_date": "2026-06-08", "end_date": "2026-06-19", "status": "DeployedToLive", "closed": True,
           "goal": "Accessibility fixes, contact and newsletter, monitoring. Site live by 19 June."},
    "s4": {"name": "Sprint 4: Events", "release": "r2", "start_date": "2026-08-31", "end_date": "2026-09-11", "status": "DeployedToUAT", "closed": True,
           "goal": "Staff can create, price and publish an event end to end."},
    "s5": {"name": "Sprint 5: Bookings", "release": "r2", "start_date": "2026-09-21", "end_date": "2026-10-02", "status": "InProgress", "closed": False,
           "goal": "Online checkout with Stripe, confirmations with QR tickets, and on-the-door check-in."},
    "s6": {"name": "Sprint 6: Donations", "release": "r3", "start_date": "2026-10-05", "end_date": "2026-10-16", "status": "NotStarted", "closed": False,
           "goal": "One-off giving live on the site with Gift Aid declarations and receipts."},
}
SPRINT_CAPACITY_HOURS = 60

# (key, feature, title, status, priority, sprint, estimate_hours, body)
REQUIREMENTS: list[tuple[str, str | None, str, str, str, str | None, float | None, str]] = [
    # Sprint 1 -- done
    ("envs", "hosting", "Provision UK-hosted UAT, staging and production environments", "Done", "High", "s1", 12,
     "Three environments on the same infrastructure definition. Production data never leaves the UK region."),
    ("cd", "hosting", "Continuous deployment from the main branch", "Done", "Medium", "s1", 8,
     "A merge to main deploys to staging; a tagged release deploys to production after a manual approval."),
    ("backup", "backups", "Nightly database backups retained for 35 days", "Done", "High", "s1", 4,
     "Restore tested once a quarter and recorded in the decision log."),
    ("shell", "shell", "Responsive site shell with header, navigation and footer", "Done", "High", "s1", 10,
     "Works from 320px up. The Donate button is always visible."),
    ("mig1", "migration", "Import the supporter spreadsheet into the new database", "Done", "High", "s1", 16,
     "1,840 rows, deduplicated on email and postcode. 112 duplicates merged and listed for Margaret to check."),
    # Sprint 2 -- done
    ("home", "home", "Home page with hero, impact figures and upcoming events", "Done", "High", "s2", 12, ""),
    ("about", "home", "About us page with programmes and trustees", "Done", "Medium", "s2", 6, ""),
    ("evlist", "evlist", "Public events listing with category and month filters", "Done", "High", "s2", 10, ""),
    ("evdetail", "evlist", "Event detail page with a booking call to action", "Done", "High", "s2", 8,
     "Until bookings ship (release 2) the button links to the booking form on the old site."),
    ("news", "news", "News listing and story pages", "Done", "Medium", "s2", 8, ""),
    # Sprint 3 -- done
    ("contact", "contact", "Contact form routed to the office inbox", "Done", "Medium", "s3", 4, ""),
    ("newsletter", "contact", "Newsletter sign-up with double opt-in", "Done", "Medium", "s3", 6,
     "Consent is recorded with the date, the IP address and the wording shown."),
    ("a11y", "shell", "Accessibility fixes to WCAG 2.2 AA", "Done", "High", "s3", 10,
     "Findings from the audit on 10 June: focus order, colour contrast on the hero, form labels."),
    ("monitoring", "backups", "Uptime monitoring with alerts to the office phone", "Done", "Medium", "s3", 4, ""),
    ("cookies", "home", "Cookie banner and privacy notice", "Done", "Low", "s3", 3, ""),
    # Sprint 4 -- done, in UAT
    ("evcreate", "evcreate", "Create, edit and duplicate an event", "Done", "High", "s4", 14, ""),
    ("tickets", "tickets", "Ticket types with adult and child pricing", "Done", "High", "s4", 8, ""),
    ("publish", "publish", "Publish an event to the public site", "Done", "High", "s4", 6, ""),
    ("soldout", "publish", "Mark an event sold out automatically at capacity", "Done", "Medium", "s4", 4, ""),
    ("cover", "evcreate", "Cover image upload with automatic resizing", "Done", "Low", "s4", 5, ""),
    # Sprint 5 -- active
    ("checkout", "checkout", "Ticket checkout with Stripe card payment", "InProgress", "High", "s5", 16,
     "Stripe Checkout rather than Elements: PCI scope stays minimal and Apple Pay and Google Pay come for free."),
    ("qr", "confirm", "Booking confirmation email with a QR ticket", "ToTest", "High", "s5", 8, ""),
    ("waitlist", "waitlist", "Waiting list when an event is sold out", "InProgress", "Medium", "s5", 8,
     "First come, first served. An offered place expires after 48 hours."),
    ("checkin", "checkin", "On-the-day check-in by name search", "NotStarted", "High", "s5", 10,
     "Partial surname match. Large tap targets: stewards are outdoors, often in gloves."),
    ("offline", "checkin", "Check-in works offline at the boathouse door", "Blocked", "Medium", "s5", 12,
     "Cache the attendee list on the phone before the doors open; sync check-ins when signal returns."),
    ("refund", "checkout", "Refund a booking from the event page", "Done", "Medium", "s5", 6, ""),
    ("reminder", "confirm", "Reminder email the day before an event", "NotStarted", "Low", "s5", 4, ""),
    # Sprint 6 -- planned
    ("oneoff", "oneoff", "One-off donation form with suggested amounts", "NotStarted", "High", "s6", 12, ""),
    ("declare", "declarations", "Gift Aid declaration captured at the point of giving", "NotStarted", "High", "s6", 8,
     "HMRC model declaration wording, versioned. The declaration records which version the donor saw."),
    ("receipt", "receipts", "Donation receipt email within a minute of payment", "NotStarted", "High", "s6", 6, ""),
    ("regular", "regular", "Monthly giving by Direct Debit through Stripe", "NotStarted", "High", "s6", 16, ""),
    ("offlinedon", "oneoff", "Record an offline donation (cash, cheque, bank transfer)", "NotStarted", "Medium", "s6", 8, ""),
    # Backlog, release 3
    ("retry", "retries", "Retry failed regular gifts and tell the donor", "NotStarted", "Medium", None, None,
     "Three retries over ten days, then an email asking for a new card."),
    ("claim", "claimprep", "Prepare a Gift Aid claim for a period", "NotStarted", "High", None, 14, ""),
    ("exclude", "claimprep", "Exclude donations without a declaration on file", "NotStarted", "High", None, 4, ""),
    ("approve", "claimprep", "Treasurer approval recorded before a claim is submitted", "NotStarted", "High", None, 6, ""),
    ("hmrc", "hmrc", "Submit the claim schedule to HMRC Charities Online", "NotStarted", "High", None, 20, ""),
    ("statement", "receipts", "Annual giving statement each April", "NotStarted", "Low", None, None, ""),
    # Backlog, release 4
    ("record", "records", "Supporter record with giving, events and volunteering history", "NotStarted", "High", None, None, ""),
    ("consent", "consent", "Record every consent change with its date and author", "NotStarted", "High", None, None, ""),
    ("segment", "segments", "Segment supporters and export to the email service", "NotStarted", "Medium", None, None, ""),
    ("profile", "profiles", "Volunteer profile with DBS and training expiry dates", "NotStarted", "Medium", None, None, ""),
    ("rota", "rota", "Weekly shift rota with reminders by SMS", "NotStarted", "Medium", None, None, ""),
    ("volsignup", "signup", "Volunteer application form on the public site", "NotStarted", "Low", None, None, ""),
    ("dash", "dashboard", "Fundraising dashboard for the office and trustees", "NotStarted", "High", None, None, ""),
    ("pack", "trusteepack", "Quarterly trustee finance pack as a PDF", "NotStarted", "Medium", None, None, ""),
    ("csv", "exports", "CSV export of any list", "NotStarted", "Low", None, None, ""),
    # Unassigned (no epic, no release): shows in the Roadmap's Unassigned card
    ("redirects", None, "Decide whether legacy WordPress URLs need redirects", "NotStarted", "Low", None, None,
     "Search traffic to the old site is small, but the regatta page is linked from the sailing club."),
]

# (entity kind, key, body) -- posted in this order, so a thread reads top to bottom
COMMENTS: list[tuple[str, str, str]] = [
    ("requirement", "offline", "Which attendees should the offline cache hold: everyone booked for today's events, or only the event the steward opens? A busy Saturday could be 400 people across three events."),
    ("requirement", "offline", "Only the event they open. Sophie says each steward works one door. Unblock once the cache size is confirmed on the front-desk iPad."),
    ("requirement", "checkout", "Stripe Checkout confirmed with the treasurer: no card details ever touch our servers."),
    ("epic", "giftaid", "Alan wants approval inside the app before anything goes to HMRC. The claim page must show who approved it and when."),
    ("release", "r2", "UAT starts on Monday 5 October with Margaret and Sophie, for two weeks. Feedback goes in the Delivery tab."),
    ("sprint", "s5", "Check-in stories are at risk this sprint while the offline question is open; refund shipped early to compensate."),
]

DOCS: list[dict[str, Any]] = [
    {
        "title": "Discovery workshop notes, 14 May 2026", "tags": ["discovery", "workshop"], "epic": None,
        "body": (
            "**Attendees:** Margaret Okafor, Dev Patel, Sophie Lambert, Alan Whitfield (trustee), Ferrous Labs.\n\n"
            "## What we heard\n\n"
            "- The office spends roughly a day a week re-keying bookings and donations between email, the bank and five spreadsheets.\n"
            "- Gift Aid claims go in late because matching donations to declarations is done by hand.\n"
            "- Sophie runs the rota in a WhatsApp group and has no list of who is coming until they arrive.\n"
            "- Supporters phone the office to change a regular gift, and Tom-style donors are wary of online payment.\n\n"
            "## Decisions\n\n"
            "1. Two products, one system: a public brochure site and a staff hub, sharing one database.\n"
            "2. Brochure site first (launch by the regatta dinner in July), then events and bookings, then donations and Gift Aid.\n"
            "3. Stripe for all payments; no card details ever stored by the trust.\n"
            "4. The mobile app is the hub itself as an installable web app, not a separate native build.\n\n"
            "## Open questions\n\n"
            "- Does the treasurer's approval of a Gift Aid claim need to be in the app, or is an email enough? (Resolved 2 June: in the app.)\n"
            "- Who owns the newsletter list once it moves out of Mailchimp?"
        ),
    },
    {
        "title": "Gift Aid rules the system must follow", "tags": ["gift-aid", "compliance"], "epic": "giftaid",
        "body": (
            "A working summary for the build team, checked against HMRC guidance in September 2026. Not legal advice; the "
            "treasurer signs off the final wording.\n\n"
            "- A declaration must name the donor, give their home address and postcode, and identify the charity.\n"
            "- The declaration wording is HMRC's model wording, stored with a version number. Each declaration records the version the donor saw.\n"
            "- A declaration can cover past donations (up to four years) and future ones; it can be withdrawn at any time.\n"
            "- Only donations of money from an individual qualify. Ticket purchases are not donations, but a donation added at checkout is.\n"
            "- A claim schedule lists each donor's title, name, house number or name, postcode, donation date and amount.\n"
            "- Claims are per period, submitted through Charities Online, and paid by BACS roughly four weeks later.\n"
            "- Anything excluded from a claim must say why, so the office can chase a missing declaration."
        ),
    },
    {
        "title": "Data migration plan", "tags": ["migration", "data"], "epic": "platform",
        "body": (
            "## Sources\n\n"
            "| Source | Rows | Owner | Notes |\n|---|---|---|---|\n"
            "| Supporters.xlsx | 1,840 | Margaret | Duplicates on email and postcode |\n"
            "| Donations 2019-2026.xlsx | 6,212 | Margaret | One sheet per financial year |\n"
            "| Gift Aid declarations (paper) | ~900 | Margaret | Scanned; date and version to be typed |\n"
            "| Events and bookings.xlsx | 1,104 | Dev | Bookings since 2023 only |\n"
            "| Volunteers.xlsx | 96 | Sophie | DBS dates incomplete |\n\n"
            "## Approach\n\n"
            "1. Import supporters first, merging duplicates and listing every merge for Margaret to approve.\n"
            "2. Import donations against the merged supporters; anything that cannot be matched goes to a holding list.\n"
            "3. Type paper declarations into the hub with their date; unclear ones are marked Not declared until confirmed.\n"
            "4. Run both systems for one month before the spreadsheets are frozen."
        ),
    },
    {
        "title": "Brand and content guidelines", "tags": ["brand", "content"], "epic": "brochure",
        "body": (
            "- **Voice:** warm, plain, local. Write for a neighbour, not a funder.\n"
            "- **Colour:** harbour blue for actions, sand for backgrounds, one accent for Donate.\n"
            "- **Type:** large. Many supporters are over 60 and read on phones.\n"
            "- **Photography:** real people, real boats, with consent recorded. No stock imagery.\n"
            "- **Numbers:** always say what the money did (\"£25 pays for a first sailing session\"), never just the total.\n"
            "- **Language:** British English throughout. \"Programme\", not \"program\"."
        ),
    },
    {
        "title": "Go-live checklist: brochure site", "tags": ["go-live"], "epic": "brochure",
        "body": (
            "- [x] Accessibility audit fixes verified by the auditor\n"
            "- [x] Privacy notice and cookie banner reviewed by the trustees\n"
            "- [x] Redirects from the top ten old URLs\n"
            "- [x] Contact form delivering to the office inbox\n"
            "- [x] Uptime alerts going to the office phone\n"
            "- [x] Backups restored once in staging\n"
            "- [x] DNS switched on 19 June at 07:00; old site kept read-only for 30 days"
        ),
    },
    {
        "title": "Decision log", "tags": ["decisions"], "epic": None,
        "body": (
            "| Date | Decision | Why |\n|---|---|---|\n"
            "| 14 May 2026 | Stripe for all payments | No card data on our side; Direct Debit supported |\n"
            "| 2 Jun 2026 | Gift Aid approval inside the app | Treasurer wants an audit trail, not an email chain |\n"
            "| 12 Jun 2026 | Mobile app is the hub as a PWA | One codebase; offline check-in still possible |\n"
            "| 9 Sep 2026 | Waiting list offers expire after 48 hours | Places were sitting unclaimed at the regatta |\n"
            "| 25 Sep 2026 | Offline cache holds one event per steward | See the discussion on the offline check-in requirement |"
        ),
    },
]

# (environment, kind, severity, title, detail, page_url, status)
FEEDBACK: list[tuple[str, str, str, str, str, str, str]] = [
    ("uat", "bug", "high", "Check-in search misses double-barrelled surnames",
     "Searching for 'Adeyemi-Cole' finds nothing; searching 'Adeyemi' finds the booking. Stewards will type the full name.",
     "https://uat.harboursidehub.example.org/events/summer-regatta-dinner/check-in", "Triaged"),
    ("uat", "feedback", "low", "Show the day of the week on event cards",
     "Margaret reads dates as 'this Saturday'. '18 Jul' on its own makes her look at a calendar.",
     "https://uat.harboursidehub.example.org/events", "Accepted"),
    ("staging", "bug", "critical", "Successful Stripe test payment leaves the booking on the waiting list",
     "Paid with the 4242 test card for a published event with places free. Stripe shows the payment; the booking shows Waiting list.",
     "https://staging.harboursidehub.example.org/events/autumn-quiz-night", "New"),
    ("production", "requirement", "medium", "Add a 'give in memory' option to the donate page",
     "Three families asked for it after the regatta dinner. Needs a name to remember and an optional message to the family.",
     "https://www.harboursidetrust.example.org/donate", "Accepted"),
    ("production", "feedback", "medium", "Newsletter confirmation email landing in spam",
     "Two supporters at the food bank said they never got the confirmation. Both found it in spam. Check the sending domain's DMARC record.",
     "https://www.harboursidetrust.example.org/", "Done"),
    ("uat", "bug", "medium", "Rota week view overflows on the front-desk iPad",
     "In landscape the Saturday column is cut off and there is no horizontal scroll.",
     "https://uat.harboursidehub.example.org/rota", "Triaged"),
]
#: The first report gets a screenshot attached, if document storage is configured.
FEEDBACK_SCREENSHOT_INDEX = 0

# (wireframe name, page name, kind, target_kind, target_id, target_cmp_id, target_label, text, resolved)
ANNOTATIONS: list[tuple[str, str, str, str, str, str | None, str, str, bool]] = [
    ("Hub app (desktop)", "Events", "note", "cmp", "c-hd-events-table", None, "Events table",
     "Margaret asked for booked and capacity in one column so she can scan the list at a glance. Keep income out of the default view for volunteers.", False),
    ("Hub app (desktop)", "Event > Check-in", "task", "element", "e-hd-checkin-search", "c-hd-checkin-list", "Check-in search",
     "Search must match on partial surnames and be usable with cold hands on the door: larger tap targets, no autocorrect.", False),
    ("Hub app (desktop)", "Gift Aid claims", "note", "cmp", "c-hd-giftaid-kpis", None, "Gift Aid position",
     "The unclaimed total must exclude any donation without a declaration on file, and anything already sitting in a draft claim.", False),
    ("Hub app (desktop)", "Dashboard", "task", "cmp", "c-hd-dashboard-kpis", None, "Headline figures",
     "Confirm with Alan whether 'Raised this month' includes offline donations and grants, or online giving only.", True),
    ("Brochure site (desktop)", "Donate", "task", "element", "e-bd-donate-giftaid", "c-bd-donate-form", "Gift Aid declaration",
     "Legal to confirm the declaration wording against HMRC's current model declaration before build.", False),
    ("Brochure site (desktop)", "Home", "note", "cmp", "c-bd-home-hero", None, "Hero",
     "Photography will come from the youth sailing open day in October; the placeholder copy is final.", False),
    ("Hub app (mobile)", "Check-in", "note", "cmp", "c-hm-checkin-list", None, "Check-in list",
     "Sophie: signal at the boathouse door is poor. The attendee list must be cached on the phone before the doors open.", False),
    ("Brochure site (mobile)", "What's on", "task", "cmp", "c-bm-events-list", None, "Events list",
     "Show the day of the week on every card. Priya reads dates as 'this Saturday', not '18 Jul'.", False),
]

SNAPSHOT_LABEL = "Client review 1 (22 Sep 2026)"
SNAPSHOT_WIREFRAMES = ["Brochure site (desktop)", "Brochure site (mobile)", "Hub app (desktop)", "Hub app (mobile)"]
ARCHIVED_WIREFRAME = "Donation kiosk concept"

BOARD_TOKEN_LABEL = "Claude Code agent (demo)"

VERSION_LABEL_SOURCE = "Discovery sign-off"
VERSION_LABEL_COPY = "Post-review build"

# ── Files ────────────────────────────────────────────────────────────────

PROJECT_BRIEF = """# Harbourside Hub: project brief

**Client:** Harbourside Community Trust (registered charity 1123456)
**Prepared by:** Ferrous Labs, May 2026

## The problem

The trust runs a food bank, a youth sailing club and a befriending service from the Old Boathouse. Its
administration lives in five spreadsheets, a paper sign-in sheet and a WordPress site nobody can edit. The
two-person office loses about a day a week to double-keying, Gift Aid claims are late, and supporters cannot
book or give online.

## What we will build

1. **A brochure website** for supporters: what's on, news, donate, volunteer, contact.
2. **A staff hub** for the office: events and bookings, donations and Gift Aid, supporters, volunteers and reporting.
3. **A mobile version of the hub** for the volunteer coordinator on the door and at the boathouse.

## Success looks like

- A supporter books and pays for an event in under two minutes on a phone.
- The quarterly Gift Aid claim is prepared in an afternoon, not a week, and reconciles to the penny.
- Nobody re-keys anything.

## Out of scope

Accounting (stays in Xero, fed by a daily journal), payroll, and the sailing club's own boat bookings.
"""

WORKSHOP_NOTES = """# Discovery workshop, 14 May 2026

Held at the Old Boathouse. Present: Margaret Okafor, Dev Patel, Sophie Lambert, Alan Whitfield, Ferrous Labs.

## Morning: how the office works today

Margaret walked us through a Tuesday: food bank session from nine, bookings arriving by email, cheques in the
post, and the donations spreadsheet updated from the bank statement on Friday. Sophie showed the rota in
WhatsApp. Dev showed the Mailchimp list, last cleaned in 2024.

## Afternoon: what good looks like

We sketched the hub's dashboard on the whiteboard. Alan asked for restricted and unrestricted funds to be
visible on day one. Everyone agreed the check-in must work at the boathouse door, where there is no signal.

## Actions

- Ferrous Labs: personas, use case model and first wireframes by 28 May.
- Margaret: export the five spreadsheets to a shared folder.
- Alan: confirm the Gift Aid approval rule with the board.
"""

MIGRATION_PLAN = """# Data migration plan

See the board document of the same name for the full table of sources. This file is the version the trustees
approved on 2 June 2026.

Order of work: supporters, then donations, then paper Gift Aid declarations, then events and bookings, then
volunteers. Both systems run side by side for one month before the spreadsheets are frozen and archived.
"""

DONATIONS_SAMPLE_CSV = """date,donor,amount,type,method,gift_aid,campaign
2026-09-28,Tom Reeves,15.00,Monthly,Direct Debit,Declared,Regular giving
2026-09-28,Anonymous,50.00,One-off,Card,Not declared,Bursary appeal
2026-09-27,Ruth Adeyemi,25.00,One-off,Card,Declared,Regular giving
2026-09-26,Westbay Rotary Club,500.00,One-off,Bank transfer,Ineligible,Regatta dinner
2026-09-25,Priya Nair,10.00,One-off,Card,Declared,Bursary appeal
2026-09-25,Colin Marsh,200.00,One-off,Cheque,Declared,General
2026-09-24,Farida Hussain,25.00,Monthly,Direct Debit,Declared,Regular giving
2026-09-22,Sam Okoro,15.00,Monthly,Card,Claimed,Regular giving
"""

EVENTS_SAMPLE_CSV = """title,date,category,capacity,booked,status,adult_price,child_price
Summer Regatta Dinner,2026-07-18,Fundraiser,180,168,Completed,35.00,15.00
Family Beach Clean,2026-07-26,Community,80,40,Completed,0.00,0.00
Sailing Taster Day,2026-08-08,Youth sailing,24,24,Completed,10.00,10.00
Harbour History Talk,2026-08-20,Talk,80,55,Completed,5.00,0.00
Volunteer Induction,2026-09-05,Volunteering,30,15,Completed,0.00,0.00
Autumn Quiz Night,2026-10-02,Fundraiser,120,96,Published,8.00,4.00
Christmas Hamper Appeal launch,2026-11-07,Community,200,0,Draft,0.00,0.00
Winter Warmer Lunch,2026-12-12,Community,60,12,Published,8.00,4.00
"""

DOCUMENTS: list[tuple[str, str, str, str]] = [
    # (filename, content type, purpose, content)
    ("Harbourside Hub - project brief.md", "text/markdown", "document", PROJECT_BRIEF),
    ("Discovery workshop notes - 14 May 2026.md", "text/markdown", "document", WORKSHOP_NOTES),
    ("Data migration plan.md", "text/markdown", "document", MIGRATION_PLAN),
    ("donations-sample.csv", "text/csv", "example_data", DONATIONS_SAMPLE_CSV),
    ("events-sample.csv", "text/csv", "example_data", EVENTS_SAMPLE_CSV),
]
