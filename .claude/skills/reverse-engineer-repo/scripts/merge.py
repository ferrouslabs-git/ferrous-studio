#!/usr/bin/env python
"""Merge the mapping pass's small files into one bundle.

Wireframes and diagrams only -- this skill doesn't produce actors, use
cases or datasets (see references/mapping-rules.md), so there is nothing
here to merge for those sections.

Expects (all optional except `pages/`):

    out/source.json          {"repo_full_name","commit_sha","generated_at","generator"}
    out/wireframe.json       {"name","interfaceType","landingPageId"}
    out/pages/*.json         one export_page-shaped page per file
    out/diagrams/*.json      one diagram per file: {"name","kind","model"}

Writes out/<repo-name>.bundle.json, where <repo-name> is the last path
segment of source.json's repo_full_name, or "bundle" if that file is absent.

Usage (from the repo root):

    .venv312/bin/python .claude/skills/reverse-engineer-repo/scripts/merge.py out
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text())


def _read_each(dir_path: Path) -> list[dict[str, Any]]:
    """One dict per *.json file in dir_path, sorted by filename so the merge
    is deterministic -- re-running produces byte-identical output when
    nothing changed, which is what makes a diff of two runs meaningful."""
    if not dir_path.is_dir():
        return []
    return [json.loads(p.read_text()) for p in sorted(dir_path.glob("*.json"))]


def merge(out_dir: Path) -> dict[str, Any]:
    source = _read_json(out_dir / "source.json", {})
    wireframe_meta = _read_json(out_dir / "wireframe.json", {})
    pages = _read_each(out_dir / "pages")
    diagrams = _read_each(out_dir / "diagrams")

    bundle: dict[str, Any] = {"schemaVersion": "1.0"}
    if source:
        bundle["source"] = source
    if pages:
        bundle["wireframes"] = [
            {
                "name": wireframe_meta.get("name", "Imported app"),
                "interfaceType": wireframe_meta.get("interfaceType", "desktop"),
                "landingPageId": wireframe_meta.get("landingPageId"),
                "pages": pages,
            }
        ]
    if diagrams:
        bundle["diagrams"] = diagrams
    return bundle


def main(argv: list[str]) -> int:
    out_dir = Path(argv[1]) if len(argv) > 1 else Path("out")
    if not out_dir.is_dir():
        print(f"no such directory: {out_dir}", file=sys.stderr)
        return 1

    bundle = merge(out_dir)
    repo_full_name = bundle.get("source", {}).get("repo_full_name", "")
    repo_name = repo_full_name.rsplit("/", 1)[-1] or "bundle"
    out_path = out_dir / f"{repo_name}.bundle.json"
    out_path.write_text(json.dumps(bundle, indent=2, sort_keys=False) + "\n")

    page_count = sum(len(w.get("pages", [])) for w in bundle.get("wireframes", []))
    print(
        f"{out_path}: {len(bundle.get('wireframes', []))} wireframe(s), {page_count} page(s), "
        f"{len(bundle.get('diagrams', []))} diagram(s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
