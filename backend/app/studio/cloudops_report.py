"""The AWS cost report behind the platform-admin CloudOps > Costs page (INT-REQ-14, phase 1).

Two halves, kept apart so the arithmetic can be tested without AWS:

* ``fetch_raw`` makes the Cost Explorer calls (about $0.01 each, so a few cents per refresh).
* ``build_report`` turns those raw answers into the plain JSON the page shows.

Money words used here, because the AWS bill mixes them:

* **usage**   what the services cost before credits and VAT
* **credits** AWS credits and refunds (a negative number)
* **before VAT** = usage + credits
* **VAT**     the Tax lines on the bill
* **with VAT** = before VAT + VAT, what the card is charged
* **effective** what the account really costs once the VAT is reclaimed = before VAT

Per-app and per-environment figures come from the ``Product`` and ``Environment`` cost allocation
tags (INT-REQ-15/16). Cost Explorer only knows a tag from the day it was activated, so older spend
shows up as "untagged"; that is reported honestly, not hidden.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

NOT_USAGE = ("Tax", "Credit", "Refund")
TOP_SERVICES = 15
UNTAGGED = "untagged"


# ---------------------------------------------------------------- dates
def month_start(d: date) -> date:
    return d.replace(day=1)


def next_month_start(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def previous_month_start(d: date) -> date:
    return month_start(month_start(d) - timedelta(days=1))


def _iso(d: date) -> str:
    return d.isoformat()


#: How many months back the picker offers, counting this month. Cost Explorer keeps 12 months by default.
HISTORY_MONTHS = 12


def parse_month(text: str | None, today: date) -> date:
    """"2026-10" -> the first of that month. None means this month. Anything in the future, older than
    the history Cost Explorer keeps, or not a YYYY-MM month raises ValueError (the route turns it into a 422)."""
    this = month_start(today)
    if not text:
        return this
    try:
        year, month = text.split("-")
        picked = date(int(year), int(month), 1)
    except (ValueError, TypeError):
        raise ValueError("month must look like 2026-10") from None
    oldest = this
    for _ in range(HISTORY_MONTHS - 1):
        oldest = previous_month_start(oldest)
    if picked > this:
        raise ValueError("that month has not started yet")
    if picked < oldest:
        raise ValueError(f"AWS only keeps the last {HISTORY_MONTHS} months")
    return picked


def as_of_for(month: date, today: date) -> date:
    """The day the report is 'as of': today for this month, the month's last day for a past month."""
    return today if month == month_start(today) else next_month_start(month) - timedelta(days=1)


# ---------------------------------------------------------------- fetching
def fetch_raw(ce: Any, today: date) -> dict[str, Any]:
    """Ask Cost Explorer for everything the report needs. ``ce`` is a boto3 'ce' client.

    The record-type totals and the by-service breakdown are required; the tag breakdowns and the
    forecast are optional (a tag with no data yet, or too little history to forecast, is normal)
    and their failure is recorded as a note instead of failing the whole refresh.
    """
    this_start, tomorrow = month_start(today), today + timedelta(days=1)
    last_start = previous_month_start(today)
    gross = {"Not": {"Dimensions": {"Key": "RECORD_TYPE", "Values": list(NOT_USAGE)}}}

    def usage(start, end, granularity, group_by=None, flt=None):
        args: dict[str, Any] = {
            "TimePeriod": {"Start": _iso(start), "End": _iso(end)},
            "Granularity": granularity,
            "Metrics": ["UnblendedCost"],
        }
        if group_by:
            args["GroupBy"] = group_by
        if flt:
            args["Filter"] = flt
        return ce.get_cost_and_usage(**args)["ResultsByTime"]

    by_record = [{"Type": "DIMENSION", "Key": "RECORD_TYPE"}]
    raw: dict[str, Any] = {
        "notes": [],
        "mtd_records": usage(this_start, tomorrow, "MONTHLY", by_record),
        "last_records": usage(last_start, this_start, "MONTHLY", by_record),
        "mtd_daily_service": usage(this_start, tomorrow, "DAILY", [{"Type": "DIMENSION", "Key": "SERVICE"}], gross),
        "last_daily": usage(last_start, this_start, "DAILY", None, gross),
    }
    for key, tag in (("mtd_by_product", "Product"), ("mtd_by_environment", "Environment")):
        try:
            raw[key] = usage(this_start, tomorrow, "MONTHLY", [{"Type": "TAG", "Key": tag}], gross)
        except Exception as e:  # tag not active yet, or no data
            raw[key] = None
            raw["notes"].append(f"{tag} tag breakdown unavailable: {type(e).__name__}")
    raw["forecast"] = None
    if tomorrow < next_month_start(today):          # nothing left to forecast on the last day
        try:
            f = ce.get_cost_forecast(TimePeriod={"Start": _iso(tomorrow), "End": _iso(next_month_start(today))},
                                     Metric="UNBLENDED_COST", Granularity="MONTHLY", Filter=gross)
            raw["forecast"] = f["Total"]["Amount"]
        except Exception as e:
            raw["notes"].append(f"Forecast unavailable: {type(e).__name__}")
    return raw


# ---------------------------------------------------------------- arithmetic
def _amount(metrics: dict) -> float:
    return float(metrics["UnblendedCost"]["Amount"])


def money(x: float) -> float:
    return round(float(x), 2) + 0.0     # the + 0.0 turns -0.0 (a rounded tiny negative) into 0.0


def by_record_type(results: list[dict]) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for r in results:
        for g in r.get("Groups", []):
            out[g["Keys"][0]] += _amount(g["Metrics"])
    return dict(out)


def totals(records: dict[str, float]) -> dict[str, float]:
    usage = sum(v for k, v in records.items() if k not in NOT_USAGE)
    credits = records.get("Credit", 0.0) + records.get("Refund", 0.0)
    vat = records.get("Tax", 0.0)
    before_vat = usage + credits
    return {"usage": money(usage), "credits": money(credits), "before_vat": money(before_vat),
            "vat": money(vat), "with_vat": money(before_vat + vat), "effective": money(before_vat)}


def grouped(results: list[dict], strip_tag: bool = False) -> list[dict]:
    acc: dict[str, float] = defaultdict(float)
    for r in results:
        for g in r.get("Groups", []):
            name = g["Keys"][0]
            if strip_tag:                        # tag keys arrive as "Product$fnai"; "Product$" means untagged
                name = name.split("$", 1)[1] if "$" in name else name
                name = name or UNTAGGED
            acc[name] += _amount(g["Metrics"])
    rows = [{"name": n, "amount": money(v)} for n, v in acc.items() if abs(v) >= 0.005]
    return sorted(rows, key=lambda x: -x["amount"])


def top_with_other(rows: list[dict], n: int = TOP_SERVICES) -> list[dict]:
    if len(rows) <= n:
        return rows
    rest = money(sum(r["amount"] for r in rows[n:]))
    return rows[:n] + ([{"name": "Other services", "amount": rest}] if rest else [])


def daily_totals(results: list[dict]) -> list[dict]:
    out = []
    for r in results:
        day = r["TimePeriod"]["Start"]
        if r.get("Groups"):
            amount = sum(_amount(g["Metrics"]) for g in r["Groups"])
        else:
            amount = float(r["Total"]["UnblendedCost"]["Amount"]) if r.get("Total") else 0.0
        out.append({"date": day, "amount": money(amount)})
    return out


def pace(daily: list[dict], mtd_usage: float, today: date, window: int = 7) -> dict[str, float] | None:
    """Month-end usage if the last few *complete* days' spend simply continues. A plain sum, no model:
    shown next to AWS's own forecast because AWS's can run well above what is actually being spent."""
    done = [d["amount"] for d in daily if d["date"] < _iso(today)][-window:]
    if not done:
        return None
    per_day = sum(done) / len(done)
    days_left = (next_month_start(today) - (today + timedelta(days=1))).days
    return {"per_day": money(per_day), "days": len(done), "month_usage": money(mtd_usage + per_day * days_left)}


def build_report(raw: dict[str, Any], today: date, now: datetime | None = None, complete: bool = False) -> dict[str, Any]:
    """``today`` is the report's as-of day. ``complete`` marks a past month: all of it is in, so there is
    nothing to forecast and no pace to project."""
    mtd = totals(by_record_type(raw["mtd_records"]))
    last = totals(by_record_type(raw["last_records"]))
    notes = list(raw.get("notes", []))

    daily = daily_totals(raw["mtd_daily_service"])
    forecast = None
    if raw.get("forecast") is not None and not complete:
        remaining = money(float(raw["forecast"]))
        forecast = {"remaining": remaining, "month_usage": money(mtd["usage"] + remaining),
                    "basis": "usage before credits and VAT"}
    at_pace = None if complete else pace(daily, mtd["usage"], today)
    if at_pace:
        forecast = {**(forecast or {"remaining": None, "month_usage": None, "basis": "usage before credits and VAT"}),
                    "at_current_pace": at_pace}

    by_app = grouped(raw["mtd_by_product"], strip_tag=True) if raw.get("mtd_by_product") is not None else None
    by_env = grouped(raw["mtd_by_environment"], strip_tag=True) if raw.get("mtd_by_environment") is not None else None
    if by_app is not None:
        tagged = sum(r["amount"] for r in by_app if r["name"] != UNTAGGED)
        notes.append("Per-app figures use the Product tag, which AWS only records from the day it was "
                     "activated, so earlier spend shows as untagged." if tagged else
                     "No tagged spend yet: the Product tag was activated recently and AWS needs up to a day to show it.")

    return {
        "generated_at": (now or datetime.now(timezone.utc)).isoformat(),
        "period": {"month_start": _iso(month_start(today)), "through": _iso(today),
                   "last_month_start": _iso(previous_month_start(today)), "complete": complete},
        "month_to_date": mtd,
        "last_month": last,
        "forecast": forecast,
        "by_service": top_with_other(grouped(raw["mtd_daily_service"])),
        "by_app": by_app,
        "by_environment": by_env,
        "daily": daily,
        "daily_previous": daily_totals(raw["last_daily"]),
        "notes": notes,
    }
