"""Identity and staff ticket SQL.

Cursors come from db_session.user_transaction, so RLS applies. Staff scope is computed from
store_members for the verified user, and every staff query filters by that scope in SQL as well as
through the policies, so a missing policy cannot widen access. SQL is module constants; request
values are only ever passed as parameters.
"""

from __future__ import annotations

import uuid
from datetime import UTC
from typing import Any

from tokolangkah_api.conversations.models import Message, Ticket
from tokolangkah_api.conversations.repository import conversation_messages
from tokolangkah_api.db_session import Cursor
from tokolangkah_api.staff.models import AuditEvent, StaffTicket, StaffTicketDetail

_STAFF_STORES_SQL = "SELECT store_id FROM store_members WHERE user_id = %s"
_CUSTOMER_STORES_SQL = (
    "SELECT s.external_id FROM customers AS c JOIN stores AS s ON s.id = c.store_id"
    " WHERE c.user_id = %s ORDER BY s.external_id"
)
_STAFF_STORE_IDS_SQL = (
    "SELECT s.external_id FROM store_members AS m JOIN stores AS s ON s.id = m.store_id"
    " WHERE m.user_id = %s ORDER BY s.external_id"
)
_IS_STAFF_SQL = "SELECT EXISTS (SELECT store_id FROM store_members WHERE user_id = %s)"
_COUNT_TICKETS_SQL = (
    "SELECT count(*) FROM tickets AS t"
    " WHERE t.store_id IN (SELECT store_id FROM store_members WHERE user_id = %s)"
    " AND (%s::text IS NULL OR t.status = %s::text)"
)
_LIST_TICKETS_SQL = (
    "SELECT t.id, t.status, t.reason, t.summary, t.created_at, t.updated_at,"
    " t.conversation_id, t.store_id, COALESCE(c.alias, '-') AS alias"
    " FROM tickets AS t"
    " LEFT JOIN customers AS c ON c.store_id = t.store_id AND c.user_id = t.customer_id"
    " WHERE t.store_id IN (SELECT store_id FROM store_members WHERE user_id = %s)"
    " AND (%s::text IS NULL OR t.status = %s::text)"
    " ORDER BY t.created_at DESC, t.id DESC LIMIT %s OFFSET %s"
)
_DETAIL_TICKET_SQL = (
    "SELECT t.id, t.status, t.reason, t.summary, t.created_at, t.updated_at,"
    " t.conversation_id, t.store_id, COALESCE(c.alias, '-') AS alias"
    " FROM tickets AS t"
    " LEFT JOIN customers AS c ON c.store_id = t.store_id AND c.user_id = t.customer_id"
    " WHERE t.id = %s"
    " AND t.store_id IN (SELECT store_id FROM store_members WHERE user_id = %s)"
)
_AUDIT_FOR_TICKET_SQL = (
    'SELECT action, "timestamp" FROM audit_events'
    ' WHERE store_id = %s AND resource_id = %s ORDER BY "timestamp", id'
)
_LOCK_TICKET_SQL = (
    "SELECT t.status, t.store_id FROM tickets AS t"
    " WHERE t.id = %s AND t.store_id IN (SELECT store_id FROM store_members WHERE user_id = %s)"
    " FOR UPDATE OF t"
)
_UPDATE_STATUS_SQL = (
    "UPDATE tickets SET status = %s WHERE id = %s"
    " RETURNING id, status, reason, summary, created_at, updated_at"
)
_INSERT_AUDIT_SQL = (
    "INSERT INTO audit_events (store_id, actor_id, action, resource_id) VALUES (%s, %s, %s, %s)"
)


def customer_stores(cursor: Cursor, user_id: uuid.UUID) -> list[str]:
    cursor.execute(_CUSTOMER_STORES_SQL, (user_id,))
    return [row[0] for row in cursor.fetchall()]


def staff_stores(cursor: Cursor, user_id: uuid.UUID) -> list[str]:
    cursor.execute(_STAFF_STORE_IDS_SQL, (user_id,))
    return [row[0] for row in cursor.fetchall()]


def is_staff(cursor: Cursor, user_id: uuid.UUID) -> bool:
    cursor.execute(_IS_STAFF_SQL, (user_id,))
    row = cursor.fetchone()
    return bool(row is not None and row[0])


def _row_to_staff_ticket(row: tuple[Any, ...]) -> StaffTicket:
    ticket_id, status, reason, summary, created, updated, _conv, _store, alias = row
    return StaffTicket(
        id=ticket_id,
        status=status,
        reason=reason,
        summary=summary,
        created_at=created.astimezone(UTC),
        updated_at=updated.astimezone(UTC),
        customer_alias=alias,
    )


def list_tickets(
    cursor: Cursor,
    user_id: uuid.UUID,
    *,
    status: str | None,
    limit: int,
    offset: int,
) -> tuple[list[StaffTicket], int]:
    cursor.execute(_COUNT_TICKETS_SQL, (user_id, status, status))
    count_row = cursor.fetchone()
    total = int(count_row[0]) if count_row is not None else 0
    cursor.execute(_LIST_TICKETS_SQL, (user_id, status, status, limit, offset))
    return [_row_to_staff_ticket(row) for row in cursor.fetchall()], total


def get_ticket_detail(
    cursor: Cursor, user_id: uuid.UUID, ticket_id: uuid.UUID
) -> StaffTicketDetail | None:
    cursor.execute(_DETAIL_TICKET_SQL, (ticket_id, user_id))
    row = cursor.fetchone()
    if row is None:
        return None
    ticket = _row_to_staff_ticket(row)
    conversation_id: uuid.UUID = row[6]
    store_id: uuid.UUID = row[7]
    transcript: list[Message] = conversation_messages(cursor, conversation_id)
    cursor.execute(_AUDIT_FOR_TICKET_SQL, (store_id, str(ticket_id)))
    audit = [
        AuditEvent(action=action, created_at=when.astimezone(UTC))
        for action, when in cursor.fetchall()
    ]
    return StaffTicketDetail(
        **ticket.model_dump(),
        transcript=transcript,
        audit=audit,
    )


def change_ticket_status(
    cursor: Cursor,
    user_id: uuid.UUID,
    ticket_id: uuid.UUID,
    new_status: str,
) -> Ticket | None:
    """Set the status and write the audit event in the caller's transaction. None when not staff."""
    cursor.execute(_LOCK_TICKET_SQL, (ticket_id, user_id))
    locked = cursor.fetchone()
    if locked is None:
        return None
    old_status: str = locked[0]
    store_id: uuid.UUID = locked[1]
    cursor.execute(_UPDATE_STATUS_SQL, (new_status, ticket_id))
    updated = cursor.fetchone()
    if updated is None:
        return None
    cursor.execute(
        _INSERT_AUDIT_SQL,
        (store_id, user_id, f"ticket.status:{old_status}->{new_status}", str(ticket_id)),
    )
    return Ticket(
        id=updated[0],
        status=updated[1],
        reason=updated[2],
        summary=updated[3],
        created_at=updated[4].astimezone(UTC),
        updated_at=updated[5].astimezone(UTC),
    )
