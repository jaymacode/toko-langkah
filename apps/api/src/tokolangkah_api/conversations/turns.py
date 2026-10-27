"""Persistence for assistant turns: idempotent messages, stored envelope, shared rate limit.

Access rules (see db/migrations/0006_chat.sql and 0007_api_role.sql):
- The customer's user message is inserted as the authenticated role under RLS (role='user' only).
- The assistant reply, its envelope and the rate-limit counter go through SECURITY DEFINER functions
  in tokolangkah_private, callable only by the API role. Each function re-checks conversation
  ownership against the verified user id in the same statement. The API role has no table
  privileges.
"""

from __future__ import annotations

import json
import math
import uuid
from typing import Any, Final

import psycopg
from fastapi import HTTPException

from tokolangkah_api.assistant.errors import AssistantUnavailable
from tokolangkah_api.db_session import Cursor
from tokolangkah_api.settings import Settings

RATE_LIMIT_PRUNE_SECONDS: Final = 86_400

# The three former owner-path statements run as SECURITY DEFINER functions (0007_api_role.sql).
# The API role cannot touch these tables directly; each function re-checks ownership in its own SQL.
_CONSUME_SQL: Final = (
    "SELECT turns, remaining_seconds"
    " FROM tokolangkah_private.consume_chat_turn(%s::uuid, %s::integer, %s::integer)"
)
_INSERT_USER_SQL: Final = (
    "INSERT INTO messages (conversation_id, role, content, client_message_id)"
    " VALUES (%s, 'user', %s, %s)"
    " ON CONFLICT (conversation_id, client_message_id)"
    " WHERE role = 'user' AND client_message_id IS NOT NULL DO NOTHING"
    " RETURNING id"
)
_SELECT_USER_SQL: Final = (
    "SELECT content FROM messages"
    " WHERE conversation_id = %s AND client_message_id = %s AND role = 'user'"
)
_STORED_SQL: Final = (
    "SELECT tokolangkah_private.stored_assistant_envelope(%s::uuid, %s::uuid, %s::uuid)"
)
_STORE_SQL: Final = (
    "SELECT tokolangkah_private.store_assistant_message("
    "%s::uuid, %s::uuid, %s::uuid, %s::text, %s::uuid, %s::jsonb)"
)


class ConflictingClientMessage(Exception):
    """The same client_message_id was reused for different text."""


def enforce_rate_limit(
    conn: psycopg.Connection[Any], settings: Settings, user_id: uuid.UUID
) -> None:
    """Count this turn in the shared fixed window; 429 with Retry-After when over the limit."""
    window = settings.assistant_rate_limit_window_seconds
    with conn.transaction(), conn.cursor() as cursor:
        cursor.execute(_CONSUME_SQL, (user_id, window, RATE_LIMIT_PRUNE_SECONDS))
        row = cursor.fetchone()
    if row is None:
        raise AssistantUnavailable("rate_limit_store")
    turns = int(row[0])
    remaining = float(row[1])
    if turns > settings.assistant_rate_limit_turns:
        retry_after = max(1, math.ceil(remaining))
        raise HTTPException(
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )


def insert_user_message(
    cursor: Cursor, conversation_id: uuid.UUID, client_message_id: uuid.UUID, content: str
) -> None:
    """Insert the customer's message once. Same text on retry is accepted; other text is 409."""
    cursor.execute(_INSERT_USER_SQL, (conversation_id, content, client_message_id))
    if cursor.fetchone() is not None:
        return
    cursor.execute(_SELECT_USER_SQL, (conversation_id, client_message_id))
    row = cursor.fetchone()
    if row is None or row[0] != content:
        raise ConflictingClientMessage()


def stored_envelope(
    conn: psycopg.Connection[Any],
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    client_message_id: uuid.UUID,
) -> dict[str, Any] | None:
    """The envelope already stored for this client message, or None. Ownership is in the SQL."""
    with conn.transaction(), conn.cursor() as cursor:
        cursor.execute(_STORED_SQL, (conversation_id, user_id, client_message_id))
        row = cursor.fetchone()
    if row is None or row[0] is None:
        return None
    payload = row[0]
    return payload if isinstance(payload, dict) else json.loads(str(payload))


def store_envelope(
    conn: psycopg.Connection[Any],
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    client_message_id: uuid.UUID,
    message_id: uuid.UUID,
    answer: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Store the assistant reply. A concurrent winner's stored envelope is returned instead."""
    serialized = json.dumps(payload, ensure_ascii=False)
    with conn.transaction(), conn.cursor() as cursor:
        cursor.execute(
            _STORE_SQL,
            (message_id, conversation_id, user_id, answer, client_message_id, serialized),
        )
        row = cursor.fetchone()
    if row is not None:
        stored = row[0]
        return stored if isinstance(stored, dict) else json.loads(str(stored))
    existing = stored_envelope(conn, user_id, conversation_id, client_message_id)
    if existing is None:
        raise AssistantUnavailable("store_failed")
    return existing
