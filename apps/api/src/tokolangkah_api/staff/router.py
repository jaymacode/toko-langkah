"""Routes: GET /me, and the staff ticket endpoints under /staff/tickets.

Staff can list, read, change status and reply in the ticket's conversation.

Staff status comes only from store_members. Customer metadata never grants it. A caller who is not
staff of the ticket's store gets the same 404 as for a ticket that does not exist.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from fastapi.responses import JSONResponse

from tokolangkah_api import db_session
from tokolangkah_api.auth import AuthenticatedUser, current_user
from tokolangkah_api.conversations.models import Ticket
from tokolangkah_api.errors import ErrorEnvelope, error_response
from tokolangkah_api.settings import Settings
from tokolangkah_api.staff import repository
from tokolangkah_api.staff.models import (
    MeResponse,
    StaffReply,
    StaffReplyResult,
    StaffTicketDetail,
    StaffTicketList,
    StatusChange,
)

MAX_LIMIT = 50
MAX_OFFSET = 1_000_000

router = APIRouter(tags=["staff"])


@router.get("/me", response_model=MeResponse)
def get_me(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
) -> MeResponse:
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        customer = repository.customer_stores(cursor, user.user_id)
        staff = repository.staff_stores(cursor, user.user_id)
    return MeResponse(user_id=user.user_id, customer_stores=customer, staff_stores=staff)


@router.get("/staff/tickets", response_model=StaffTicketList)
def list_staff_tickets(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    status: Annotated[Literal["open", "in_progress", "resolved"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 20,
    offset: Annotated[int, Query(ge=0, le=MAX_OFFSET)] = 0,
) -> StaffTicketList:
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        if not repository.is_staff(cursor, user.user_id):
            raise HTTPException(status_code=404)
        items, total = repository.list_tickets(
            cursor, user.user_id, status=status, limit=limit, offset=offset
        )
    return StaffTicketList(items=items, total=total)


def _parse_ticket_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=404) from exc


@router.get("/staff/tickets/{ticket_id}", response_model=StaffTicketDetail)
def get_staff_ticket(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    ticket_id: Annotated[str, Path(max_length=64)],
) -> StaffTicketDetail:
    tid = _parse_ticket_id(ticket_id)
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        detail = repository.get_ticket_detail(cursor, user.user_id, tid)
    if detail is None:
        raise HTTPException(status_code=404)
    return detail


@router.post(
    "/staff/tickets/{ticket_id}/messages",
    response_model=StaffReplyResult,
    status_code=201,
    responses={409: {"model": ErrorEnvelope}},
)
def post_staff_reply(
    request: Request,
    response: Response,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    body: StaffReply,
    ticket_id: Annotated[str, Path(max_length=64)],
) -> StaffReplyResult | JSONResponse:
    """Staff answers the customer in the ticket's conversation. 404 for anyone but store staff."""
    tid = _parse_ticket_id(ticket_id)
    settings: Settings = request.app.state.settings
    try:
        with (
            db_session.connect(settings) as conn,
            db_session.user_transaction(conn, user.user_id) as cursor,
        ):
            result = repository.add_staff_reply(
                cursor, user.user_id, tid, body.client_message_id, body.content
            )
    except repository.TicketResolved:
        return error_response(
            request, 409, "ticket_resolved", "The ticket is resolved; the assistant has the chat."
        )
    except repository.ConflictingStaffMessage:
        raise HTTPException(status_code=409) from None
    if result is None:
        raise HTTPException(status_code=404)
    message, ticket, created = result
    response.status_code = 201 if created else 200
    return StaffReplyResult(message=message, ticket=ticket)


@router.patch("/staff/tickets/{ticket_id}", response_model=Ticket)
def change_staff_ticket_status(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    body: StatusChange,
    ticket_id: Annotated[str, Path(max_length=64)],
) -> Ticket:
    tid = _parse_ticket_id(ticket_id)
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        ticket = repository.change_ticket_status(cursor, user.user_id, tid, body.status)
    if ticket is None:
        raise HTTPException(status_code=404)
    return ticket
