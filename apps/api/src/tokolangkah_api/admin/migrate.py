"""Apply db/migrations/*.sql to the database in DATABASE_URL (admin path, table owner).

Run:  uv run python -m tokolangkah_api.admin.migrate [--with-local-shim]

Each migration and its tracking row commit in one transaction. Tracking lives in the
private schema `tokolangkah_private`, which is never granted to anon/authenticated, so it is
not exposed through the Supabase Data API. The local shim (db/local/*.sql) is applied only
when --with-local-shim is passed and is refused for Supabase hosts. With the shim, the local
login for the API role (0007) is also set from the credential in the environment
(the value is never stored in this file).
Exit codes: 0 done, 1 failed, 2 refused/BLOCKED.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[5]
MIGRATIONS_DIR = ROOT / "db" / "migrations"
LOCAL_SHIM_DIR = ROOT / "db" / "local"
SUPABASE_HOST_SUFFIXES = ("supabase.co", "supabase.com")

_TRACKING_DDL = """
CREATE SCHEMA IF NOT EXISTS tokolangkah_private;
REVOKE ALL ON SCHEMA tokolangkah_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS tokolangkah_private.schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
"""

# Earlier runs tracked migrations in public.schema_migrations; carry those rows over once.
_LEGACY_IMPORT = """
DO $$
BEGIN
    IF to_regclass('public.schema_migrations') IS NOT NULL THEN
        INSERT INTO tokolangkah_private.schema_migrations (filename, applied_at)
        SELECT filename, applied_at FROM public.schema_migrations
        ON CONFLICT (filename) DO NOTHING;
        DROP TABLE public.schema_migrations;
    END IF;
END
$$;
"""


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").rstrip(".").lower()


def migrate(url: str, *, with_local_shim: bool, local_api_password: str | None = None) -> list[str]:
    """Apply pending migrations; return the filenames applied in this run."""
    if with_local_shim and _host(url).endswith(SUPABASE_HOST_SUFFIXES):
        raise PermissionError("the local auth shim must never be applied to a Supabase database")
    applied_now: list[str] = []
    with psycopg.connect(url, connect_timeout=10) as conn:
        with conn.transaction():
            conn.execute(_TRACKING_DDL)
            conn.execute(_LEGACY_IMPORT)
        if with_local_shim:
            for shim in sorted(LOCAL_SHIM_DIR.glob("*.sql")):
                with conn.transaction():
                    conn.execute(shim.read_text(encoding="utf-8"))
        rows = conn.execute("SELECT filename FROM tokolangkah_private.schema_migrations").fetchall()
        done = {row[0] for row in rows}
        files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        if not files:
            raise FileNotFoundError(f"no migrations found in {MIGRATIONS_DIR}")
        pending = [f for f in files if f.name not in done]
        print(f"migrations: {len(done)} applied, {len(pending)} pending", flush=True)
        for migration in pending:
            print(f"applying {migration.name}", flush=True)
            with conn.transaction():
                conn.execute(migration.read_text(encoding="utf-8"))
                conn.execute(
                    "INSERT INTO tokolangkah_private.schema_migrations (filename) VALUES (%s)",
                    (migration.name,),
                )
            applied_now.append(migration.name)
        if with_local_shim and local_api_password:
            with conn.transaction():
                conn.execute(_local_api_login_sql(local_api_password))
    return applied_now


# Local development ONLY. The API login role is created NOLOGIN by 0007; a local Docker database
# needs a login for the API and the DB tests. scripts/tasks.py db-migrate passes the local-only
# credential in the env var below. This module contains no credential. Never used for Supabase.
LOCAL_API_ROLE = "tokolangkah_api"
LOCAL_API_CREDENTIAL_ENV = "TOKOLANGKAH_LOCAL_API_CREDENTIAL"


def _local_api_login_sql(password: str) -> sql.Composed:
    return sql.SQL("ALTER ROLE {} LOGIN PASSWORD {}").format(
        sql.Identifier(LOCAL_API_ROLE), sql.Literal(password)
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--with-local-shim", action="store_true")
    args = parser.parse_args(argv)
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        print("BLOCKED: DATABASE_URL not set", file=sys.stderr)
        return 2
    try:
        migrate(
            url,
            with_local_shim=args.with_local_shim,
            local_api_password=os.environ.get(LOCAL_API_CREDENTIAL_ENV, "").strip() or None,
        )
    except PermissionError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    except (psycopg.Error, FileNotFoundError) as exc:
        # Driver messages can include connection details; print only the class and SQL state.
        state = getattr(exc, "sqlstate", None)
        print(f"FAILED: {type(exc).__name__} sqlstate={state}", file=sys.stderr)
        return 1
    print("db-migrate: done", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
