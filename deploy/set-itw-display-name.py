#!/usr/bin/env python3
"""Set In the Wild display_name for a user by email."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

from sqlalchemy import text

ROOT = Path(__file__).resolve().parent.parent


def _migrate_db():
    path = ROOT / "deploy" / "referrall-migrate-db.py"
    spec = importlib.util.spec_from_file_location("referrall_migrate_db", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    email = os.environ.get("ITW_USER_EMAIL", "").strip().lower()
    display_name = os.environ.get("ITW_DISPLAY_NAME", "").strip()

    if not email:
        print("ITW_USER_EMAIL is required.", file=sys.stderr)
        return 1
    if len(display_name) < 2:
        print("ITW_DISPLAY_NAME must be at least 2 characters.", file=sys.stderr)
        return 1

    migrate_db = _migrate_db()
    engine = migrate_db.make_engine()
    with engine.begin() as conn:
        result = conn.execute(
            text(
                "UPDATE t1inthewild_user "
                "SET display_name = :display_name "
                "WHERE lower(email) = lower(:email)"
            ),
            {"display_name": display_name[:120], "email": email},
        )
        if result.rowcount == 0:
            print(f"No In the Wild user found for {email}", file=sys.stderr)
            return 1

    print(f"OK  display_name set to {display_name!r} for {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
