#!/usr/bin/env python3
"""Load DATABASE_URL for Referr-All migration scripts and run DDL statements."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text


def _parse_env_line(line: str) -> tuple[str, str] | None:
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if line.startswith("export "):
        line = line[7:].strip()
    if "=" not in line:
        return None
    key, _, value = line.partition("=")
    key = key.strip()
    value = value.strip().strip('"').strip("'")
    return key, value


def _load_env_file(path: Path) -> None:
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parsed = _parse_env_line(line)
        if not parsed:
            continue
        key, value = parsed
        if not key or not value:
            continue
        if key == "DATABASE_URL" or key not in os.environ:
            os.environ[key] = value


def _checkout_kind() -> str:
    """Infer dev (Website) vs prod (website-referrall) from script location."""
    root = Path(__file__).resolve().parent.parent
    name = root.name.lower()
    if name == "website-referrall" or "website-referrall" in str(root).lower():
        return "prod"
    return "dev"


def _systemd_env_files() -> list[Path]:
    paths: list[Path] = []
    preferred = os.getenv("REFERRALL_MIGRATION_SERVICE", "").strip()
    if preferred:
        services = [preferred]
    elif _checkout_kind() == "prod":
        services = ["webapi-referrall"]
    else:
        services = ["roryportfolio", "webapi-dev"]
    for service in services:
        if not service:
            continue
        try:
            out = subprocess.check_output(
                ["systemctl", "show", service, "-p", "EnvironmentFiles", "--value"],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except (OSError, subprocess.CalledProcessError):
            continue
        for part in out.split():
            cleaned = part.lstrip(":")
            path = Path(cleaned)
            if path.is_file() and path not in paths:
                paths.append(path)
    return paths


def _migration_env_candidates() -> list[Path]:
    candidates: list[Path] = []
    seen: set[str] = set()

    def add(raw: str) -> None:
        if not raw:
            return
        path = Path(raw)
        key = str(path)
        if key in seen or not path.is_file():
            return
        seen.add(key)
        candidates.append(path)

    add(os.getenv("ENV_FILE", "").strip())

    for path in _systemd_env_files():
        add(str(path))

    root = Path(__file__).resolve().parent.parent
    if _checkout_kind() == "prod":
        for raw in (
            "/home/ubuntu/website-referrall/.env.referrall",
            str(root / ".env.referrall"),
        ):
            add(raw)
    else:
        for raw in (
            "/home/ubuntu/Website/.env.dev",
            str(root / ".env.dev"),
            "/home/ubuntu/Website/.env",
            str(root / ".env"),
        ):
            add(raw)

    return candidates


def bootstrap_database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url

    candidates = _migration_env_candidates()

    for path in candidates:
        _load_env_file(path)
        url = os.getenv("DATABASE_URL", "").strip()
        if url:
            print(f"==> Loaded DATABASE_URL from {path}", file=sys.stderr)
            return url

    print("ERR  DATABASE_URL not set. Checked:", file=sys.stderr)
    for path in candidates:
        print(f"       {path}", file=sys.stderr)
    sys.exit("DATABASE_URL not set")


def normalize_database_url(url: str) -> str:
    u = url.strip()
    if u.startswith("postgresql+psycopg://") or u.startswith("postgresql+psycopg2://"):
        return u
    if u.startswith("postgres://"):
        return "postgresql+psycopg://" + u[len("postgres://") :]
    if u.startswith("postgresql://"):
        return "postgresql+psycopg://" + u[len("postgresql://") :]
    return u


def make_engine():
    url = normalize_database_url(bootstrap_database_url())
    return create_engine(url, pool_pre_ping=True)


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "--print-url":
        print(normalize_database_url(bootstrap_database_url()))
        return
    if len(sys.argv) < 2:
        print("Usage: referrall-migrate-db.py [--print-url | '<SQL>' ...]", file=sys.stderr)
        sys.exit(2)
    engine = make_engine()
    with engine.begin() as conn:
        for sql in sys.argv[1:]:
            conn.execute(text(sql))


if __name__ == "__main__":
    main()
