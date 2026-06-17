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


def _systemd_env_files() -> list[Path]:
    paths: list[Path] = []
    for service in (
        os.getenv("REFERRALL_SYSTEMD_SERVICE", ""),
        "roryportfolio",
        "webapi-dev",
        "webapi-referrall",
    ):
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


def bootstrap_database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url

    candidates: list[Path] = []
    for raw in (
        os.getenv("ENV_FILE", "").strip(),
        "/home/ubuntu/Website/.env.dev",
        "/home/ubuntu/Website/.env",
        "/home/ubuntu/website-referrall/.env.referrall",
        str(Path(__file__).resolve().parent.parent / ".env.dev"),
        str(Path(__file__).resolve().parent.parent / ".env"),
    ):
        if raw:
            path = Path(raw)
            if path.is_file() and path not in candidates:
                candidates.append(path)

    for path in _systemd_env_files():
        if path not in candidates:
            candidates.append(path)

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
