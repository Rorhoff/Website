"""Apply incremental In the Wild schema upgrades (safe to re-run)."""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_itw_schema(engine: Engine) -> None:
    """Create missing ITW tables and add columns introduced after initial deploy."""
    import models  # noqa: F401
    from database import Base

    itw_tables = [t for t in Base.metadata.sorted_tables if t.name.startswith("t1inthewild_")]
    Base.metadata.create_all(engine, tables=itw_tables)

    if not inspect(engine).has_table("t1inthewild_user"):
        return

    statements = [
        "ALTER TABLE t1inthewild_user "
        "ADD COLUMN IF NOT EXISTS venue_match_alerts BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE t1inthewild_user "
        "ADD COLUMN IF NOT EXISTS city_latitude DOUBLE PRECISION",
        "ALTER TABLE t1inthewild_user "
        "ADD COLUMN IF NOT EXISTS city_longitude DOUBLE PRECISION",
    ]
    if inspect(engine).has_table("t1inthewild_event"):
        statements.append(
            "ALTER TABLE t1inthewild_event "
            "ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36) "
            "REFERENCES t1inthewild_user(id) ON DELETE SET NULL"
        )

    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))

        if inspect(engine).has_table("t1inthewild_user_report"):
            conn.execute(
                text(
                    "ALTER TABLE t1inthewild_user_report "
                    "ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE t1inthewild_user_report "
                    "ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP"
                )
            )
