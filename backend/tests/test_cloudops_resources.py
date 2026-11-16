"""The CloudOps > Resources list (INT-REQ-14, phase 2, read-only): how a service's state, size, cost, URLs and
auto-wake settings are worked out, and the rules around the route. No database and no AWS."""
import inspect

import pytest
from fastapi import HTTPException

from app.studio import cloudops, cloudops_resources as res

WAKER = "arn:tg/waker"
TG = "arn:tg/app"


TAG_NAMES = {"cloudops_autowake": "cloudops:autowake", "cloudops_idle_minutes": "cloudops:idle-minutes",
             "cloudops_keep_awake_until": "cloudops:keep-awake-until", "cloudops_follows": "cloudops:follows"}


def tags(**t):
    return [{"key": TAG_NAMES.get(k, k), "value": v} for k, v in t.items()]


def svc(name="studio-staging", desired=1, running=1, pending=0, tg=TG, tag_list=None, ip="ENABLED", deployments=None):
    return {"serviceName": name, "status": "ACTIVE", "desiredCount": desired, "runningCount": running,
            "pendingCount": pending, "taskDefinition": "td1",
            "loadBalancers": [{"targetGroupArn": tg}] if tg else [],
            "networkConfiguration": {"awsvpcConfiguration": {"assignPublicIp": ip}},
            "deployments": deployments or [{"rolloutState": "COMPLETED"}],
            "tags": tag_list if tag_list is not None else [{"key": "Product", "value": "ferrous-studio"}, {"key": "Environment", "value": "staging"}]}


def raw(services, rules=None, healthy=1):
    return {"services": services, "task_defs": {"td1": {"cpu": "256", "memory": "512"}},
            "health": {TG: healthy}, "rules": rules or []}


def rule(hosts, targets=(TG,), protocol="HTTPS", parked_for=None, headers=()):
    return {"arn": "r", "protocol": protocol, "hosts": list(hosts), "headers": list(headers),
            "targets": list(targets), "parked_for": parked_for}


def row(service, **kw):
    return res.build_rows(raw([service], **kw))[0]


# ----------------------------------------------------------------- state
def test_running_and_healthy():
    assert row(svc())["state"] == "running"


def test_scaled_to_zero_is_asleep_when_auto_wake_is_on_otherwise_stopped():
    on = svc(desired=0, running=0, tag_list=tags(Product="x", Environment="staging", cloudops_autowake="true"))
    assert row(on)["state"] == "asleep"
    assert row(svc(desired=0, running=0))["state"] == "stopped"


def test_wanted_but_not_running_yet_is_starting():
    assert row(svc(desired=1, running=0, pending=1))["state"] == "starting"


def test_running_without_a_healthy_target_is_unhealthy():
    r = row(svc(), healthy=0)
    assert r["state"] == "unhealthy" and "no healthy target" in r["state_detail"]


def test_a_failed_deployment_is_unhealthy_even_while_an_old_task_runs():
    assert row(svc(deployments=[{"rolloutState": "FAILED"}]))["state"] == "unhealthy"


def test_a_worker_with_no_load_balancer_is_running_when_its_count_is_met():
    assert row(svc("worker-uat", tg=None))["state"] == "running"
    assert row(svc("worker-uat", desired=2, running=1, tg=None))["state"] == "starting"


# ----------------------------------------------------------------- size and cost
def test_a_small_task_costs_about_what_the_ticket_says():
    assert res.per_task_month(0.25, 0.5, True) == 12.66          # ticket: about $12.70 a month
    assert res.per_task_month(0.25, 0.5, False) == 9.01          # the public IP is the $3.65 difference


def test_cost_now_follows_running_tasks_and_cost_when_running_follows_wanted():
    stopped = row(svc(desired=0, running=0))
    assert stopped["cost"] == {"per_task": 12.66, "now": 0.0, "when_running": 12.66}
    two = row(svc(desired=2, running=2))
    assert two["cost"]["now"] == 25.32 and two["cost"]["when_running"] == 25.32


def test_size_reads_the_task_definition_units():
    r = row(svc())
    assert (r["vcpu"], r["memory_gb"]) == (0.25, 0.5)


def test_totals_add_up_across_services():
    out = res.build_report(raw([svc("a", 1, 1), svc("b", 0, 0)]))
    assert out["totals"] == {"now": 12.66, "when_all_running": 25.32}


# ----------------------------------------------------------------- app, environment, addresses
def test_the_tags_say_what_app_and_environment_a_service_is():
    r = row(svc("anything-at-all"))
    assert (r["app"], r["environment"], r["app_source"]) == ("ferrous-studio", "staging", "tag")


def test_an_untagged_service_falls_back_to_its_name():
    r = row(svc("fnai-worker-uat", tag_list=[]))
    assert (r["app"], r["environment"], r["app_source"]) == ("fnai", "uat", "name")
    assert row(svc("mystery", tag_list=[]))["app"] == "unknown"


def test_addresses_come_from_the_rules_that_forward_to_the_service():
    rules = [rule(["staging.studio.example.com"]), rule(["other.example.com"], targets=("arn:tg/other",))]
    assert row(svc(), rules=rules)["urls"] == ["https://staging.studio.example.com"]


def test_a_host_reachable_on_https_and_http_shows_once_as_https():
    rules = [rule(["a.example.com"], protocol="HTTP"), rule(["a.example.com"], protocol="HTTPS")]
    assert row(svc(), rules=rules)["urls"] == ["https://a.example.com"]


def test_an_address_parked_at_the_waker_still_belongs_to_its_service():
    rules = [rule(["a.example.com"], targets=(WAKER,), parked_for="studio-staging")]
    assert row(svc(desired=0, running=0), rules=rules)["urls"] == ["https://a.example.com"]
    assert row(svc("someone-else"), rules=rules)["urls"] == []


def test_a_service_reached_only_by_a_header_rule_says_so_instead_of_showing_a_blank():
    r = row(svc("trustos-staging"), rules=[rule([], headers=["X-Origin-Verify"], protocol="HTTP")])
    assert r["urls"] == [] and r["reached_via"] == ["a request header rule (X-Origin-Verify)"]


# ----------------------------------------------------------------- auto-wake and guards
def test_auto_wake_settings_are_read_from_the_tags():
    t = tags(Product="p", Environment="staging", cloudops_autowake="true", cloudops_idle_minutes="90",
             cloudops_keep_awake_until="2026-11-20T18:00:00Z")
    assert row(svc(tag_list=t))["autowake"] == {"enabled": True, "idle_minutes": 90,
                                                "keep_awake_until": "2026-11-20T18:00:00Z", "follows": None}
    assert row(svc())["autowake"]["enabled"] is False


def test_a_bad_idle_value_is_ignored_not_a_crash():
    t = tags(Product="p", Environment="staging", cloudops_idle_minutes="soon")
    assert row(svc(tag_list=t))["autowake"]["idle_minutes"] is None


def test_production_is_flagged_and_listed_first():
    rows = res.build_rows(raw([svc("a-staging"), svc("b-prod", tag_list=tags(Product="b", Environment="prod"))]))
    assert [r["service"] for r in rows] == ["b-prod", "a-staging"]
    assert rows[0]["production"] is True and rows[1]["production"] is False


# ----------------------------------------------------------------- fetching, with fake clients
class FakePager:
    def __init__(self, pages): self.pages = pages
    def paginate(self, **kw): return iter(self.pages)


class FakeECS:
    def __init__(self, services): self.services, self.calls = services, []
    def get_paginator(self, name): return FakePager([{"serviceArns": [s["serviceName"] for s in self.services]}])

    def describe_services(self, cluster, services, include=()):
        self.calls.append(("describe_services", len(services)))
        return {"services": [s for s in self.services if s["serviceName"] in services]}

    def describe_task_definition(self, taskDefinition):
        return {"taskDefinition": {"cpu": "256", "memory": "512"}}


class FakeELB:
    def __init__(self, with_waker=True): self.with_waker = with_waker
    def describe_target_health(self, TargetGroupArn): return {"TargetHealthDescriptions": [{"TargetHealth": {"State": "healthy"}}]}

    def describe_target_groups(self, TargetGroupArns=None, Names=None):
        if Names:
            if not self.with_waker:
                raise RuntimeError("TargetGroupNotFound")
            return {"TargetGroups": [{"TargetGroupArn": WAKER}]}
        return {"TargetGroups": [{"LoadBalancerArns": ["alb1"]}]}

    def describe_listeners(self, LoadBalancerArn): return {"Listeners": [{"ListenerArn": "l1", "Protocol": "HTTPS"}]}

    def describe_rules(self, ListenerArn):
        return {"Rules": [
            {"RuleArn": "r1", "IsDefault": False, "Actions": [{"Type": "forward", "TargetGroupArn": WAKER}],
             "Conditions": [{"HostHeaderConfig": {"Values": ["x.example.com"]}}]},
            {"RuleArn": "r2", "IsDefault": False, "Actions": [{"Type": "redirect"}],
             "Conditions": [{"HostHeaderConfig": {"Values": ["y.example.com"]}}]},
            {"RuleArn": "d", "IsDefault": True, "Actions": [], "Conditions": []}]}

    def describe_tags(self, ResourceArns):
        return {"TagDescriptions": [{"ResourceArn": a, "Tags": [{"Key": "cloudops:service", "Value": "studio-staging"}]} for a in ResourceArns]}


def test_fetch_reads_services_rules_and_who_a_parked_rule_belongs_to():
    out = res.fetch_raw(FakeECS([svc()]), FakeELB())
    assert out["health"] == {TG: 1}
    assert [r["arn"] for r in out["rules"]] == ["r1"]            # redirect rule and default rule are not listed
    assert out["rules"][0]["parked_for"] == "studio-staging"
    assert res.build_report(out)["services"][0]["urls"] == ["https://x.example.com"]


def test_fetch_copes_with_the_auto_wake_stack_not_being_deployed():
    out = res.fetch_raw(FakeECS([svc()]), FakeELB(with_waker=False))
    assert all(r["parked_for"] is None for r in out["rules"])


def test_services_are_read_ten_at_a_time():
    ecs = FakeECS([svc(f"s{i}") for i in range(23)])
    res.fetch_raw(ecs, FakeELB())
    assert [n for _, n in ecs.calls] == [10, 10, 3]


# ----------------------------------------------------------------- the route
class Admin:
    email = "admin@example.com"


@pytest.fixture
def wired(monkeypatch):
    calls = {"admin": [], "aws": 0}

    async def ensure(user, action, db, permission="accounts:manage"):
        calls["admin"].append(permission)

    class S:
        cloudops_enabled = True

    def run():
        calls["aws"] += 1
        return {"services": [], "totals": {"now": 0, "when_all_running": 0}}

    monkeypatch.setattr(cloudops, "ensure_platform_admin", ensure)
    monkeypatch.setattr(cloudops, "get_settings", lambda: S)
    monkeypatch.setattr(cloudops, "_run_resources", run)
    calls["settings"] = S
    return calls


async def test_the_route_is_read_only_and_admin_checked(wired):
    r = await cloudops.get_resources(current_user=Admin(), db=None)
    assert r.enabled is True and r.resources["services"] == []
    assert wired["admin"] == ["accounts:read"]
    assert wired["aws"] == 1


async def test_where_cloudops_is_off_nothing_is_asked_of_aws(wired):
    wired["settings"].cloudops_enabled = False
    r = await cloudops.get_resources(current_user=Admin(), db=None)
    assert r.enabled is False and wired["aws"] == 0


async def test_a_denied_aws_call_is_explained(wired, monkeypatch):
    class AccessDeniedException(Exception):
        pass

    def boom():
        raise AccessDeniedException("not authorized: ecs:ListServices")

    monkeypatch.setattr(cloudops, "_run_resources", boom)
    with pytest.raises(HTTPException) as e:
        await cloudops.get_resources(current_user=Admin(), db=None)
    assert e.value.status_code == 502 and "ECS and load balancer read permission" in e.value.detail


def test_phase_2_can_never_change_anything_in_aws():
    """Read from the real source files (not the fakes the other tests swap in): the list must hold no call
    that starts, stops, scales, tags or re-routes anything. Phase 3 adds those, with their own review."""
    src = inspect.getsource(cloudops) + inspect.getsource(res)
    for verb in ("update_service", "tag_resource", "untag_resource", "modify_rule", "start_task", "stop_task",
                 "create_service", "delete_service", "register_task_definition", "add_tags", "remove_tags", "put_"):
        assert verb not in src, verb
