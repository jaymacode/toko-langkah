"""Database sessions that carry a verified identity into PostgreSQL, so RLS applies.

user_transaction is the only way user-scoped SQL runs in this API. It switches the transaction to
the `authenticated` role and sets request.jwt.claims (transaction-local) to the subject of a
verified JWT, which is what auth.uid() reads. The subject always comes from auth.current_user,
never from a request body, path or model argument.

Connection failures and unavailable dependencies become the generic 503 envelope. Driver messages
are never returned or logged, because they can contain connection details.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from tokolangkah_api.db import DB_CONNECT_TIMEOUT_SECONDS, DB_STATEMENT_TIMEOUT_MS
from tokolangkah_api.errors import ErrorBody, ErrorEnvelope
from tokolangkah_api.request_id import REQUEST_ID_HEADER, request_id_from_scope
from tokolangkah_api.settings import Settings

Connection = psycopg.Connection[tuple[Any, ...]]
Cursor = psycopg.Cursor[tuple[Any, ...]]

logger = logging.getLogger(__name__)


class ServiceUnavailable(Exception):
    """A required dependency is not configured or not reachable. Mapped to a 503 envelope."""


@contextmanager
def connect(settings: Settings) -> Iterator[Connection]:
    """Open one bounded connection as the API role. Raises ServiceUnavailable when unset."""
    url = settings.request_database_url()
    if url is None:
        raise ServiceUnavailable("database is not configured")
    with psycopg.connect(
        url.get_secret_value(),
        connect_timeout=DB_CONNECT_TIMEOUT_SECONDS,
        options=f"-c statement_timeout={DB_STATEMENT_TIMEOUT_MS}",
    ) as connection:
        yield connection


@contextmanager
def user_transaction(conn: Connection, user_id: uuid.UUID) -> Iterator[Cursor]:
    """One transaction as the signed-in user: RLS sees exactly what that user may see."""
    claims = json.dumps({"sub": str(user_id), "role": "authenticated"})
    with conn.transaction(), conn.cursor() as cursor:
        cursor.execute("SET LOCAL ROLE authenticated")
        cursor.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims,))
        yield cursor


@contextmanager
def anon_transaction(conn: Connection) -> Iterator[Cursor]:
    """One transaction as the anon role, for the public catalogue only."""
    with conn.transaction(), conn.cursor() as cursor:
        cursor.execute("SET LOCAL ROLE anon")
        cursor.execute("SELECT set_config('request.jwt.claims', %s, true)", ('{"role":"anon"}',))
        yield cursor


def _service_unavailable(request: Request, exc: Exception) -> JSONResponse:
    # Log the exception class only; the message may contain a connection string.
    logger.warning("service unavailable type=%s", type(exc).__name__)
    request_id = request_id_from_scope(request.scope)
    envelope = ErrorEnvelope(
        error=ErrorBody(
            code="service_unavailable",
            message="Service unavailable.",
            request_id=request_id,
        )
    )
    return JSONResponse(
        envelope.model_dump(),
        status_code=503,
        headers={REQUEST_ID_HEADER: request_id},
    )


def register_service_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ServiceUnavailable, _service_unavailable)
    app.add_exception_handler(psycopg.OperationalError, _service_unavailable)
