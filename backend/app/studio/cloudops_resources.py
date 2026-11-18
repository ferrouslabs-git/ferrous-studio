"""The ECS services behind the platform-admin CloudOps > Resources page (INT-REQ-14, phase 2: read-only).

Two halves, kept apart so the logic can be tested without AWS:

* ``fetch_raw`` makes the (free) ECS and load balancer read calls.
* ``build_rows`` turns the raw answers into one row per service: its app and environment, its state,
  its size and estimated monthly cost, the web addresses that reach it, and its auto-wake settings.

Read-only. Nothing here changes a service; starting and stopping is a later phase with its own review.

Where the app and environment come from: the ``Product`` and ``Environment`` tags on the service
(INT-REQ-15/16), with the service name as a fallback for a service that has not been tagged yet.
"""
from __future__ import annotations

import os
import re
from typing import Any

CLUSTER = "default"
HOURS_PER_MONTH = 730
#: eu-west-1 Fargate list prices, Linux/x86, USD (checked Nov 2026). An estimate, not the bill.
VCPU_HOUR = 0.04048
GB_HOUR = 0.004445
PUBLIC_IPV4_HOUR = 0.005                    # about $3.65 a month per task with a public IP
WAKER_TG_NAME = "cloudops-autowake-waker"

TAG_PRODUCT, TAG_ENV = "Product", "Environment"
TAG_AUTOWAKE, TAG_IDLE, TAG_KEEP, TAG_FOLLOWS = (
    "cloudops:autowake", "cloudops:idle-minutes", "cloudops:keep-awake-until", "cloudops:follows")
RULE_TAG = "cloudops:service"               # on a listener rule the auto-wake function parked at its waker


# ---------------------------------------------------------------- fetching
def fetch_raw(ecs: Any, elbv2: Any) -> dict[str, Any]:
    """All the read calls the page needs. ``ecs`` and ``elbv2`` are boto3 clients."""
    arns = [a for p in ecs.get_paginator("list_services").paginate(cluster=CLUSTER) for a in p["serviceArns"]]
    services: list[dict] = []
    for i in range(0, len(arns), 10):
        services += ecs.describe_services(cluster=CLUSTER, services=arns[i:i + 10], include=["TAGS"])["services"]
    services = [s for s in services if s.get("status") == "ACTIVE"]

    task_defs: dict[str, dict] = {}
    for td in sorted({s["taskDefinition"] for s in services}):
        t = ecs.describe_task_definition(taskDefinition=td)["taskDefinition"]
        task_defs[td] = {"cpu": t.get("cpu"), "memory": t.get("memory")}

    tg_arns = sorted({lb["targetGroupArn"] for s in services for lb in s.get("loadBalancers", []) if lb.get("targetGroupArn")})
    health: dict[str, int] = {}
    alb_arns: set[str] = set()
    for tg in tg_arns:
        d = elbv2.describe_target_health(TargetGroupArn=tg)["TargetHealthDescriptions"]
        health[tg] = sum(1 for t in d if t["TargetHealth"]["State"] == "healthy")
        for g in elbv2.describe_target_groups(TargetGroupArns=[tg])["TargetGroups"]:
            alb_arns.update(g.get("LoadBalancerArns", []))

    rules: list[dict] = []
    waker = None
    try:
        waker = elbv2.describe_target_groups(Names=[WAKER_TG_NAME])["TargetGroups"][0]["TargetGroupArn"]
    except Exception:
        pass                                        # the auto-wake stack is not deployed: nothing is ever parked
    for alb in sorted(alb_arns):
        for lis in elbv2.describe_listeners(LoadBalancerArn=alb)["Listeners"]:
            for r in elbv2.describe_rules(ListenerArn=lis["ListenerArn"])["Rules"]:
                if r.get("IsDefault"):
                    continue
                targets = {t["TargetGroupArn"] for a in r.get("Actions", []) if a.get("Type") == "forward"
                           for t in (a.get("ForwardConfig", {}).get("TargetGroups", []) or [{"TargetGroupArn": a.get("TargetGroupArn")}])
                           if t.get("TargetGroupArn")}
                hosts = [v for c in r.get("Conditions", []) for v in c.get("HostHeaderConfig", {}).get("Values", [])]
                headers = [c["HttpHeaderConfig"]["HttpHeaderName"] for c in r.get("Conditions", []) if c.get("HttpHeaderConfig")]
                if targets and (hosts or headers):
                    rules.append({"arn": r["RuleArn"], "protocol": lis["Protocol"], "hosts": hosts, "headers": headers,
                                  "targets": sorted(targets), "parked_for": None})
    if waker:
        parked = [r for r in rules if r["targets"] == [waker]]
        for i in range(0, len(parked), 20):
            chunk = parked[i:i + 20]
            for d in elbv2.describe_tags(ResourceArns=[r["arn"] for r in chunk])["TagDescriptions"]:
                owner = {t["Key"]: t["Value"] for t in d["Tags"]}.get(RULE_TAG)
                for r in chunk:
                    if r["arn"] == d["ResourceArn"]:
                        r["parked_for"] = owner
    return {"services": services, "task_defs": task_defs, "health": health, "rules": rules}


# ---------------------------------------------------------------- building rows
def tags_of(svc: dict) -> dict[str, str]:
    return {t["key"]: t["value"] for t in svc.get("tags", [])}


_NAME = re.compile(r"^(?P<app>.+?)-(?P<env>prod|staging|uat|dev)$")


def app_and_env(svc: dict) -> tuple[str, str, str]:
    """(app, environment, where it came from). The tags win; the name is only a fallback."""
    t = tags_of(svc)
    if t.get(TAG_PRODUCT) and t.get(TAG_ENV):
        return t[TAG_PRODUCT], t[TAG_ENV], "tag"
    m = _NAME.match(svc["serviceName"])
    if m:
        app = m["app"].removesuffix("-worker")
        return t.get(TAG_PRODUCT) or app, t.get(TAG_ENV) or m["env"], "name"
    return t.get(TAG_PRODUCT) or "unknown", t.get(TAG_ENV) or "unknown", "name"


def size_of(td: dict) -> tuple[float, float]:
    """(vCPU, GB) from the task definition's task-level cpu (units) and memory (MiB)."""
    return int(td.get("cpu") or 0) / 1024, int(td.get("memory") or 0) / 1024


def per_task_month(vcpu: float, gb: float, public_ip: bool) -> float:
    cost = (vcpu * VCPU_HOUR + gb * GB_HOUR + (PUBLIC_IPV4_HOUR if public_ip else 0.0)) * HOURS_PER_MONTH
    return round(cost + 0.0, 2)


def state_of(svc: dict, healthy: int | None, autowake: bool) -> tuple[str, str]:
    """(state, a short reason). running / asleep / stopped / starting / unhealthy."""
    desired, running, pending = svc["desiredCount"], svc["runningCount"], svc.get("pendingCount", 0)
    failed = any(d.get("rolloutState") == "FAILED" for d in svc.get("deployments", []))
    if desired == 0 and running == 0:
        return ("asleep", "scaled to zero; wakes on a visit") if autowake else ("stopped", "scaled to zero")
    if failed:
        return "unhealthy", "the last deployment failed"
    if running == 0:
        return "starting", f"{desired} wanted, none running yet" if pending or desired else "starting"
    if healthy is not None and healthy < 1:
        return "unhealthy", "running, but no healthy target behind the load balancer"
    if running < desired:
        return "starting", f"{running} of {desired} running"
    return "running", f"{running} running"


def urls_for(svc: dict, rules: list[dict]) -> list[str]:
    """Web addresses whose listener rules forward to this service, or that the auto-wake function parked for it."""
    tgs = {lb["targetGroupArn"] for lb in svc.get("loadBalancers", []) if lb.get("targetGroupArn")}
    found: dict[str, str] = {}
    for r in rules:
        mine = bool(tgs & set(r["targets"])) or r.get("parked_for") == svc["serviceName"]
        if not mine:
            continue
        for h in r["hosts"]:
            scheme = "https" if r["protocol"] == "HTTPS" else "http"
            if found.get(h) != "https":                  # a host reachable on both shows once, as https
                found[h] = scheme
    return [f"{scheme}://{host}" for host, scheme in sorted(found.items())]


def reached_via(svc: dict, rules: list[dict]) -> list[str]:
    """Rules that reach this service by a request header and no hostname (TrustOS, behind CloudFront)."""
    tgs = {lb["targetGroupArn"] for lb in svc.get("loadBalancers", []) if lb.get("targetGroupArn")}
    return sorted({f"a request header rule ({h})" for r in rules if not r["hosts"] and tgs & set(r["targets"]) for h in r.get("headers", [])})


def autowake_of(svc: dict) -> dict[str, Any]:
    t = tags_of(svc)
    try:
        idle = int(t[TAG_IDLE]) if TAG_IDLE in t else None
    except ValueError:
        idle = None
    return {"enabled": t.get(TAG_AUTOWAKE) == "true", "idle_minutes": idle,
            "keep_awake_until": t.get(TAG_KEEP) or None, "follows": t.get(TAG_FOLLOWS) or None}


def own_service() -> str:
    """The ECS service this app itself runs as. It is never changed from its own panel: stopping it would switch the
    panel off with no way back except the AWS console. ECS_SERVICE_NAME is set by the deploy scripts' task definition;
    the fallback rebuilds the same name from APP_NAME ("<product>-api") and APP_ENV."""
    explicit = os.getenv("ECS_SERVICE_NAME", "").strip()
    if explicit:
        return explicit
    product = os.getenv("APP_NAME", "").strip().removesuffix("-api")
    return f"{product}-{os.getenv('APP_ENV', 'local').strip()}" if product else ""


def build_rows(raw: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    own = own_service()
    for svc in raw["services"]:
        tg = next((lb["targetGroupArn"] for lb in svc.get("loadBalancers", []) if lb.get("targetGroupArn")), None)
        aw = autowake_of(svc)
        app, env, source = app_and_env(svc)
        vcpu, gb = size_of(raw["task_defs"].get(svc["taskDefinition"], {}))
        public_ip = (svc.get("networkConfiguration", {}).get("awsvpcConfiguration", {}).get("assignPublicIp") == "ENABLED")
        each = per_task_month(vcpu, gb, public_ip)
        state, why = state_of(svc, raw["health"].get(tg) if tg else None, aw["enabled"])
        rows.append({
            "service": svc["serviceName"],
            "app": app, "environment": env, "app_source": source,
            "state": state, "state_detail": why,
            "desired": svc["desiredCount"], "running": svc["runningCount"],
            "vcpu": vcpu, "memory_gb": gb, "public_ip": public_ip,
            "cost": {"per_task": each, "now": round(each * svc["runningCount"] + 0.0, 2),
                     "when_running": round(each * max(1, svc["desiredCount"]) + 0.0, 2)},
            "urls": urls_for(svc, raw["rules"]),
            "reached_via": reached_via(svc, raw["rules"]),
            "autowake": aw,
            "production": "-prod" in svc["serviceName"],
            "protected": bool(own) and svc["serviceName"] == own,
        })
    order = {"prod": 0, "uat": 1, "staging": 2, "dev": 3}
    return sorted(rows, key=lambda r: (order.get(r["environment"], 9), r["app"], r["service"]))


def build_report(raw: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(raw)
    return {
        "services": rows,
        "totals": {"now": round(sum(r["cost"]["now"] for r in rows) + 0.0, 2),
                   "when_all_running": round(sum(r["cost"]["when_running"] for r in rows) + 0.0, 2)},
        "pricing_note": "Estimated from Fargate list prices (vCPU, memory and a public IPv4 address) per running task. "
                        "The bill on the Costs page is the real figure.",
    }
