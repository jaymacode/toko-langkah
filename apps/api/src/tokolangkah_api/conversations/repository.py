"""Conversation, message and ticket SQL.

Cursors come from db_session.user_transaction, so RLS applies. The SQL strings are module constants:
no request value is ever formatted into SQL, only passed as a parameter.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from tokolangkah_api.conversations.models import Message, Ticket
from tokolangkah_api.db_session import Cursor

TICKET_COLUMNS_SQL = "id, status, reason, summary, created_at, updated_at"
TICKET_LIST_LIMIT = 100

_CUSTOMER_STORE_SQL = (
    "SELECT s.id FROM customers AS c JOIN stores AS s ON s.id = c.store_id"
    " WHERE c.user_id = %s ORDER BY s.slug LIMIT 1"
)
_CREATE_CONVERSATION_SQL = (
    "INSERT INTO conversations (store_id, customer_id) VALUES (%s, %s) RETURNING id"
)
_CONVERSATION_HEADER_SQL = "SELECT created_at, store_id FROM conversations WHERE id = %s"
_CONVERSATION_MESSAGES_SQL = (
    "SELECT role, content, created_at FROM messages"
    " WHERE conversation_id = %s ORDER BY created_at, id"
)
_INSERT_TICKET_SQL = (
    "INSERT INTO tickets (store_id, customer_id, conversation_id, summary, reason,"
    " idempotency_key)"
    " VALUES (%s, %s, %s, %s, %s, %s)"
    " ON CONFLICT ON CONSTRAINT tickets_idempotency_uniq DO NOTHING"
    " RETURNING id, status, reason, summary, created_at, updated_at"
)
_SELECT_TICKET_BY_KEY_SQL = (
    "SELECT id, status, reason, summary, created_at, updated_at FROM tickets"
    " WHERE store_id = %s AND customer_id = %s AND conversation_id = %s AND idempotency_key = %s"
)
_OWN_TICKETS_SQL = (
    "SELECT id, status, reason, summary, created_at, updated_at FROM tickets"
    " WHERE customer_id = %s ORDER BY created_at DESC, id DESC LIMIT %s"
)


def customer_store(cursor: Cursor, user_id: uuid.UUID) -> uuid.UUID | None:
    """The store the caller is a customer of. Deterministic when several match (lowest slug)."""
    cursor.execute(_CUSTOMER_STORE_SQL, (user_id,))
    row = cursor.fetchone()
    return None if row is None else row[0]


def create_conversation(cursor: Cursor, store_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
    cursor.execute(_CREATE_CONVERSATION_SQL, (store_id, user_id))
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError("INSERT ... RETURNING produced no row")
    return row[0]  # type: ignore[no-any-return]


def conversation_header(
    cursor: Cursor, conversation_id: uuid.UUID
) -> tuple[datetime, uuid.UUID] | None:
    """(created_at, store_id) for a conversation the caller can see, else None."""
    cursor.execute(_CONVERSATION_HEADER_SQL, (conversation_id,))
    row: tuple[Any, ...] | None = cursor.fetchone()
    if row is None:
        return None
    return row[0], row[1]


def conversation_messages(cursor: Cursor, conversation_id: uuid.UUID) -> list[Message]:
    cursor.execute(_CONVERSATION_MESSAGES_SQL, (conversation_id,))
    return [
        Message(role=role, content=content, created_at=created.astimezone(UTC))
        for role, content, created in cursor.fetchall()
    ]


def _row_to_ticket(row: tuple[Any, ...]) -> Ticket:
    ticket_id, status, reason, summary, created, updated = row
    return Ticket(
        id=ticket_id,
        status=status,
        reason=reason,
        summary=summary,
        created_at=created.astimezone(UTC),
        updated_at=updated.astimezone(UTC),
    )


def insert_ticket_once(
    cursor: Cursor,
    *,
    store_id: uuid.UUID,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    reason: str,
    summary: str,
    idempotency_key: str,
) -> tuple[Ticket, bool]:
    """Create the ticket, or return the existing one for the same owner, conversation and key.

    INSERT ... ON CONFLICT DO NOTHING, then a SELECT, inside the caller's transaction. Concurrent
    retries serialise on the unique index: exactly one row is inserted, and every caller then reads
    that row. Returns (ticket, created).
    """
    cursor.execute(
        _INSERT_TICKET_SQL,
        (store_id, user_id, conversation_id, summary, reason, idempotency_key),
    )
    inserted = cursor.fetchone()
    if inserted is not None:
        return _row_to_ticket(inserted), True
    cursor.execute(
        _SELECT_TICKET_BY_KEY_SQL,
        (store_id, user_id, conversation_id, idempotency_key),
    )
    existing = cursor.fetchone()
    if existing is None:
        raise RuntimeError("ticket for idempotency key not visible after conflict")
    return _row_to_ticket(existing), False


def own_tickets(cursor: Cursor, user_id: uuid.UUID) -> list[Ticket]:
    cursor.execute(_OWN_TICKETS_SQL, (user_id, TICKET_LIST_LIMIT))
    return [_row_to_ticket(row) for row in cursor.fetchall()]
