#!/usr/bin/env python
"""Validate a bundle file against Ferrous Studio's real rules.

Runs the exact same ``validate_bundle()`` the import endpoint runs, so a
bundle that passes here is one the server has already been told is clean --
run this after every merge, not just once at the end.

Usage (from the repo root, with .venv312 providing the backend's deps):

    .venv312/bin/python .claude/skills/reverse-engineer-repo/scripts/validate.py out/repo.bundle.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# .claude/skills/reverse-engineer-repo/scripts/validate.py -> repo root -> backend
BACKEND = Path(__file__).resolve().parents[4] / "backend"
sys.path.insert(0, str(BACKEND))

from app.studio.catalog import get_catalog  # noqa: E402
from app.studio.importing import validate_bundle, wrap_bare_envelope  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 1
    path = Path(argv[1])
    if not path.is_file():
        print(f"no such file: {path}", file=sys.stderr)
        return 1

    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        print(f"{path}: not valid JSON -- {exc}", file=sys.stderr)
        return 1

    bundle = wrap_bare_envelope(raw)
    errors = validate_bundle(bundle, get_catalog())

    if not errors:
        print(f"{path}: clean")
        return 0

    print(f"{path}: {len(errors)} problem(s)")
    for error in errors:
        print(f"  {error.path or '(bundle)'}: {error.message}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
