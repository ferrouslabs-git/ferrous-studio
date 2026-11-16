"""The CloudOps > Costs report (INT-REQ-14, phase 1): the arithmetic, the Cost Explorer calls, and the
rules around the page (admin only, no AWS call just from opening it, refresh throttle, environment switch).

No database and no AWS: Cost Explorer and the session are faked, like the rest of this suite."""
import inspect
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.studio import cloudops, cloudops_report as rep
from app.studio.models import utc_now


# ----------------------------------------------------------------- sample Cost Explorer answers
def group(key, amount):
    return {"Keys": [key], "Metrics": {"UnblendedCost": {"Amount": str(amount), "Unit": "USD"}}}


def month(*groups):
    return [{"TimePeriod": {"Start": "2026-11-01", "End": "2026-11-17"}, "Groups": list(groups), "Total": {}}]


def day(d, *groups):
    return {"TimePeriod": {"Start": d, "End": d}, "Groups": list(groups), "Total": {}}


def raw(**over):
    base = {
        "notes": [],
        "mtd_records": month(group("Usage", 100.0), group("Support", 5.0), group("Credit", -33.29), group("Tax", 11.61)),
        "last_records": month(group("Usage", 244.75), group("Credit", -244.75), group("Tax", 0)),
        "mtd_daily_service": [day("2026-11-01", group("Amazon Elastic Container Service", 3.0), group("Amazon RDS", 1.5)),
                              day("2026-11-02", group("Amazon Elastic Container Service", 3.0), group("Amazon RDS", 1.5))],
        "last_daily": [day("2026-10-31", group("X", 4.0))],
        "mtd_by_product": month(group("Product$fnai", 60), group("Product$shared", 30), group("Product$", 10)),
        "mtd_by_environment": month(group("Environment$uat", 40), group("Environment$", 60)),
        "forecast": "120.50",
    }
    base.update(over)
    return base


TODAY = date(2026, 11, 16)


# ----------------------------------------------------------------- the arithmetic
def test_money_words_add_up_and_credits_are_shown_separately():
    r = rep.build_report(raw(), TODAY)["month_to_date"]
    assert r["usage"] == 105.0                  # usage and support, before credits and VAT
    assert r["credits"] == -33.29               # shown on its own so a covered month never looks free
    assert r["before_vat"] == 71.71
    assert r["vat"] == 11.61
    assert r["with_vat"] == 83.32
    assert r["effective"] == r["before_vat"]    # VAT is reclaimed


def test_last_month_fully_covered_by_credits_is_zero_but_its_usage_is_visible():
    r = rep.build_report(raw(), TODAY)["last_month"]
    assert r["usage"] == 244.75 and r["before_vat"] == 0.0 and r["with_vat"] == 0.0


def test_refunds_count_with_credits_and_no_negative_zero():
    t = rep.totals({"Usage": 10.0, "Refund": -10.0, "Tax": 0.0})
    assert t["credits"] == -10.0 and t["before_vat"] == 0.0 and str(t["before_vat"]) == "0.0"


def test_a_tiny_floating_point_leftover_never_prints_as_negative_zero():
    t = rep.totals({"Usage": 244.75, "Credit": -244.75000000000003, "Tax": 0.0})
    assert t["before_vat"] == 0.0 and str(t["before_vat"]) == "0.0"
    assert str(t["with_vat"]) == "0.0" and str(t["effective"]) == "0.0"
    assert str(rep.money(-1e-13)) == "0.0"


def test_by_service_is_biggest_first_and_sums_the_days():
    by = rep.build_report(raw(), TODAY)["by_service"]
    assert by[0] == {"name": "Amazon Elastic Container Service", "amount": 6.0}
    assert by[1] == {"name": "Amazon RDS", "amount": 3.0}


def test_a_long_tail_of_services_is_folded_into_other():
    rows = [{"name": f"s{i}", "amount": 100 - i} for i in range(20)]
    out = rep.top_with_other(rows, 15)
    assert len(out) == 16 and out[-1]["name"] == "Other services"
    assert out[-1]["amount"] == sum(r["amount"] for r in rows[15:])


def test_daily_series_for_this_month_and_last():
    rr = rep.build_report(raw(), TODAY)
    assert rr["daily"] == [{"date": "2026-11-01", "amount": 4.5}, {"date": "2026-11-02", "amount": 4.5}]
    assert rr["daily_previous"] == [{"date": "2026-10-31", "amount": 4.0}]


# ----------------------------------------------------------------- tags and the forecast
def test_per_app_uses_the_product_tag_and_untagged_is_named_honestly():
    rr = rep.build_report(raw(), TODAY)
    assert rr["by_app"] == [{"name": "fnai", "amount": 60.0}, {"name": "shared", "amount": 30.0}, {"name": "untagged", "amount": 10.0}]
    assert rr["by_environment"][0] == {"name": "untagged", "amount": 60.0}
    assert any("only records from the day it was activated" in n for n in rr["notes"])


def test_no_tagged_spend_yet_says_so_instead_of_showing_a_confident_split():
    rr = rep.build_report(raw(mtd_by_product=month(group("Product$", 105))), TODAY)
    assert rr["by_app"] == [{"name": "untagged", "amount": 105.0}]
    assert any("No tagged spend yet" in n for n in rr["notes"])


def test_a_missing_tag_breakdown_is_none_not_an_error():
    rr = rep.build_report(raw(mtd_by_product=None, mtd_by_environment=None), TODAY)
    assert rr["by_app"] is None and rr["by_environment"] is None


def test_forecast_is_what_remains_plus_what_is_spent_and_says_what_it_excludes():
    f = rep.build_report(raw(), TODAY)["forecast"]
    assert (f["remaining"], f["month_usage"], f["basis"]) == (120.5, 225.5, "usage before credits and VAT")


def test_at_current_pace_projects_the_recent_daily_average_over_the_rest_of_the_month():
    days = [{"date": f"2026-11-{d:02d}", "amount": 10.0} for d in range(1, 9)] + [{"date": "2026-11-09", "amount": 4.0}]
    p = rep.pace(days, mtd_usage=84.0, today=date(2026, 11, 9))
    # the partial current day (the 9th) is left out; 7 complete days at $10; 21 days remain after the 9th
    assert p == {"per_day": 10.0, "days": 7, "month_usage": 294.0}


def test_pace_needs_at_least_one_complete_day():
    assert rep.pace([{"date": "2026-11-01", "amount": 3.0}], 3.0, date(2026, 11, 1)) is None


def test_the_report_carries_both_awss_forecast_and_the_simple_pace():
    f = rep.build_report(raw(), TODAY)["forecast"]
    assert f["month_usage"] == 225.5 and f["at_current_pace"]["per_day"] == 4.5
    only_pace = rep.build_report(raw(forecast=None), TODAY)["forecast"]
    assert only_pace["month_usage"] is None and only_pace["at_current_pace"]["month_usage"] > 0


def test_month_boundaries_including_december():
    assert rep.next_month_start(date(2026, 12, 15)) == date(2027, 1, 1)
    assert rep.previous_month_start(date(2027, 1, 3)) == date(2026, 12, 1)
    assert rep.next_month_start(date(2026, 11, 30)) == date(2026, 12, 1)


# ----------------------------------------------------------------- the Cost Explorer calls
class FakeCE:
    def __init__(self, fail_tags=False, fail_forecast=False):
        self.calls, self.fail_tags, self.fail_forecast = [], fail_tags, fail_forecast

    def get_cost_and_usage(self, **kw):
        self.calls.append(kw)
        if self.fail_tags and kw.get("GroupBy", [{}])[0].get("Type") == "TAG":
            raise RuntimeError("tag not active")
        return {"ResultsByTime": []}

    def get_cost_forecast(self, **kw):
        self.calls.append(kw)
        if self.fail_forecast:
            raise RuntimeError("not enough data")
        return {"Total": {"Amount": "50"}}


def test_a_refresh_makes_a_handful_of_calls_and_only_ever_reads():
    ce = FakeCE()
    out = rep.fetch_raw(ce, TODAY)
    assert len(ce.calls) == 7                                  # about a cent each
    assert out["forecast"] == "50"
    first = ce.calls[0]
    assert first["TimePeriod"] == {"Start": "2026-11-01", "End": "2026-11-17"}   # End is exclusive: through today
    usage_calls = [c for c in ce.calls if "Filter" in c]
    assert usage_calls and all(c["Filter"]["Not"]["Dimensions"]["Values"] == ["Tax", "Credit", "Refund"] for c in usage_calls)


def test_the_forecast_covers_usage_only_so_its_label_is_true():
    ce = FakeCE()
    rep.fetch_raw(ce, TODAY)
    forecast = next(c for c in ce.calls if "Metric" in c)
    assert forecast["Filter"]["Not"]["Dimensions"]["Values"] == ["Tax", "Credit", "Refund"]


def test_an_inactive_tag_or_no_forecast_is_a_note_and_the_refresh_still_works():
    out = rep.fetch_raw(FakeCE(fail_tags=True, fail_forecast=True), TODAY)
    assert out["mtd_by_product"] is None and out["forecast"] is None
    assert len(out["notes"]) == 3
    rep.build_report(out, TODAY)                               # and the report still builds


def test_no_forecast_is_requested_on_the_last_day_of_the_month():
    ce = FakeCE()
    rep.fetch_raw(ce, date(2026, 11, 30))
    assert not any("Metric" in c and c.get("Granularity") == "MONTHLY" and "Metrics" not in c for c in ce.calls)


# ----------------------------------------------------------------- the routes
class FakeDB:
    def __init__(self):
        self.added, self.executed, self.committed = [], [], 0

    def add(self, row): self.added.append(row)
    async def flush(self): pass
    async def execute(self, stmt): self.executed.append(stmt)
    async def commit(self): self.committed += 1

    async def refresh(self, row):
        row.id = row.id or __import__("uuid").uuid4()
        row.created_at = row.created_at or utc_now()


class Admin:
    id = __import__("uuid").uuid4()
    email = "admin@example.com"


@pytest.fixture
def wired(monkeypatch):
    calls = {"admin": [], "report": 0}

    async def ensure(user, action, db, permission="accounts:manage"):
        calls["admin"].append(permission)

    def run_report():
        calls["report"] += 1
        return {"month_to_date": {"usage": 1.0}, "notes": []}

    async def no_snapshot(db):
        return None

    class S:
        cloudops_enabled = True

    monkeypatch.setattr(cloudops, "ensure_platform_admin", ensure)
    monkeypatch.setattr(cloudops, "_run_report", run_report)
    monkeypatch.setattr(cloudops, "_latest", no_snapshot)
    monkeypatch.setattr(cloudops, "get_settings", lambda: S)
    calls["settings"] = S
    return calls


async def test_opening_the_page_reads_the_last_report_and_asks_aws_nothing(wired):
    r = await cloudops.get_costs(current_user=Admin(), db=FakeDB())
    assert r.enabled is True and r.snapshot is None
    assert wired["report"] == 0 and wired["admin"] == ["accounts:read"]
    assert "_run_report" not in inspect.getsource(cloudops.get_costs)


async def test_where_cloudops_is_off_the_page_says_so_and_a_refresh_is_refused(wired):
    wired["settings"].cloudops_enabled = False
    assert (await cloudops.get_costs(current_user=Admin(), db=FakeDB())).enabled is False
    with pytest.raises(HTTPException) as e:
        await cloudops.refresh_costs(current_user=Admin(), db=FakeDB())
    assert e.value.status_code == 403 and "not enabled" in e.value.detail
    assert wired["report"] == 0


async def test_non_admins_are_stopped_before_anything_else(monkeypatch):
    async def deny(*a, **k):
        raise HTTPException(403, "no")

    monkeypatch.setattr(cloudops, "ensure_platform_admin", deny)
    for fn in (cloudops.get_costs, cloudops.refresh_costs):
        with pytest.raises(HTTPException) as e:
            await fn(current_user=Admin(), db=FakeDB())
        assert e.value.status_code == 403


async def test_a_refresh_fetches_saves_prunes_and_credits_the_person(wired):
    db = FakeDB()
    r = await cloudops.refresh_costs(current_user=Admin(), db=db)
    assert wired["report"] == 1 and db.committed == 1
    assert len(db.added) == 1 and len(db.executed) == 1          # one new row, one prune
    assert r.snapshot.created_by == "admin@example.com" and r.snapshot.report["month_to_date"]["usage"] == 1.0


async def test_a_second_click_within_a_minute_costs_nothing(wired, monkeypatch):
    fresh = cloudops.CostSnapshotRead(id=__import__("uuid").uuid4(), created_at=utc_now() - timedelta(seconds=10), report={})

    async def latest(db):
        return fresh

    monkeypatch.setattr(cloudops, "_latest", latest)
    r = await cloudops.refresh_costs(current_user=Admin(), db=FakeDB())
    assert r.snapshot is fresh and wired["report"] == 0


async def test_an_old_report_does_not_block_a_refresh(wired, monkeypatch):
    old = cloudops.CostSnapshotRead(id=__import__("uuid").uuid4(), created_at=utc_now() - timedelta(minutes=5), report={})

    async def latest(db):
        return old

    monkeypatch.setattr(cloudops, "_latest", latest)
    await cloudops.refresh_costs(current_user=Admin(), db=FakeDB())
    assert wired["report"] == 1


async def test_missing_aws_permission_is_explained_not_a_bare_500(wired, monkeypatch):
    class AccessDeniedException(Exception):
        pass

    def boom():
        raise AccessDeniedException("User is not authorized to perform: ce:GetCostAndUsage")

    monkeypatch.setattr(cloudops, "_run_report", boom)
    with pytest.raises(HTTPException) as e:
        await cloudops.refresh_costs(current_user=Admin(), db=FakeDB())
    assert e.value.status_code == 502 and "Cost Explorer read permission" in e.value.detail


def test_every_cloudops_route_checks_for_a_platform_admin_first():
    from app.main import app
    from starlette.routing import Mount

    def walk(routes, prefix=""):
        for r in routes:
            if isinstance(r, Mount):
                yield from walk(r.routes, prefix + r.path)
            elif hasattr(r, "endpoint"):
                yield prefix + r.path, r

    routes = [(p, r) for p, r in walk(app.routes) if "/cloudops" in p]
    assert len(routes) == 3                         # costs, costs/refresh, resources
    for path, route in routes:
        src = inspect.getsource(route.endpoint)
        assert "ensure_platform_admin" in src, path
        assert src.index("ensure_platform_admin") < src.index("get_settings"), path   # who you are before anything else
