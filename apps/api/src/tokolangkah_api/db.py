"""Bounded PostgreSQL reachability probe. Never returns or logs connection details."""

from __future__ import annotations

import logging

import psycopg

from tokolangkah_api.settings import Settings

logger = logging.getLogger(__name__)

DB_CONNECT_TIMEOUT_SECONDS = 2
DB_STATEMENT_TIMEOUT_MS = 2000


def check_database(settings: Settings) -> bool:
    """Return True only if the API database URL is set and SELECT 1 succeeds within the timeouts."""
    url = settings.request_database_url()
    if url is None:
        return False
    try:
        with psycopg.connect(
            url.get_secret_value(),
            connect_timeout=DB_CONNECT_TIMEOUT_SECONDS,
            options=f"-c statement_timeout={DB_STATEMENT_TIMEOUT_MS}",
        ) as connection:
            connection.execute("SELECT 1").fetchone()
    except psycopg.Error as exc:
        # Log only the exception class: driver messages can contain the connection string.
        logger.warning("database health check failed type=%s", type(exc).__name__)
        return False
    return True
