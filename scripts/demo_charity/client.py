"""A thin HTTP client for the Studio API.

Standard library only (urllib), like ``scripts/import_sma_board.py``, so the
seed runs from any laptop with a Python interpreter and no extra installs.

Every studio route is organisation-scoped through ``X-Scope-Type`` /
``X-Scope-ID`` -- the headers the frontend adds on every call -- so the
client carries the organisation id once it is known and stamps it on every
request from then on.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class ApiError(RuntimeError):
    def __init__(self, status: int, method: str, url: str, body: str):
        super().__init__(f"{method} {url} -> HTTP {status}: {body[:800]}")
        self.status = status
        self.body = body

    def json(self) -> Any:
        try:
            return json.loads(self.body)
        except ValueError:
            return None


class Client:
    def __init__(self, base_url: str, token: str | None, verbose: bool = False):
        self.base = base_url.rstrip("/")
        self.token = token
        self.org_id: str | None = None
        self.verbose = verbose

    # ── raw ──────────────────────────────────────────────────────────────

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        scoped: bool = True,
        raw: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        url = path if path.startswith("http") else f"{self.base}{path}"
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(url, data=data, method=method)
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        if scoped and self.org_id:
            req.add_header("X-Scope-Type", "account")
            req.add_header("X-Scope-ID", self.org_id)
        if raw is None and data is not None:
            req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        if self.verbose:
            print(f"    {method} {path}")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                text = resp.read().decode() if resp.length != 0 else ""
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as exc:
            raise ApiError(exc.code, method, url, exc.read().decode(errors="replace")) from None

    # ── conveniences ─────────────────────────────────────────────────────

    def get(self, path: str, **kw: Any) -> Any:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> Any:
        return self.request("POST", path, body, **kw)

    def patch(self, path: str, body: Any = None, **kw: Any) -> Any:
        return self.request("PATCH", path, body, **kw)

    def put(self, path: str, body: Any = None, **kw: Any) -> Any:
        return self.request("PUT", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> Any:
        return self.request("DELETE", path, **kw)

    def put_bytes(self, url: str, payload: bytes, headers: dict[str, str]) -> None:
        """A presigned S3 PUT: no bearer token, no scope headers."""
        req = urllib.request.Request(url, data=payload, method="PUT")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            raise ApiError(exc.code, "PUT", url.split("?")[0], exc.read().decode(errors="replace")) from None
