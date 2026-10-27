"""Routes for conversations, escalations and the caller's own tickets.

POST /conversations, GET /conversations/{id}, POST /conversations/{id}/escalations, GET /tickets.
The store scope comes from the verified customer row, never from the request. Not-found and
not-yours both return the same 404.
"""

from __future__ import annotations

import uuid
from datetime import UTC
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response

from tokolangkah_api import db_session
from tokolangkah_api.assistant.embeddings import Embedder
from tokolangkah_api.assistant.orchestrator import TurnInput, run_turn
from tokolangkah_api.assistant.planner import Planner
from tokolangkah_api.assistant.providers import build_embedder, build_planner
from tokolangkah_api.auth import AuthenticatedUser, current_user
from tokolangkah_api.conversations import repository, turns
from tokolangkah_api.conversations.models import (
    Conversation,
    ConversationCreated,
    EscalationRequest,
    TicketEnvelope,
    TicketList,
    TurnEnvelope,
    TurnRequest,
)
from tokolangkah_api.settings import Settings

router = APIRouter(tags=["conversations"])


def _parse_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=404) from exc


@router.post("/conversations", response_model=ConversationCreated, status_code=201)
def create_conversation(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
) -> ConversationCreated:
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        store_id = repository.customer_store(cursor, user.user_id)
        if store_id is None:
            raise HTTPException(status_code=403)
        conversation_id = repository.create_conversation(cursor, store_id, user.user_id)
    return ConversationCreated(id=conversation_id)


@router.get("/conversations/{conversation_id}", response_model=Conversation)
def get_conversation(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    conversation_id: Annotated[str, Path(max_length=64)],
) -> Conversation:
    conv_uuid = _parse_id(conversation_id)
    settings: Settings = request.app.state.settings
    with db_session.connect(settings) as conn:
        with db_session.user_transaction(conn, user.user_id) as cursor:
            header = repository.conversation_header(cursor, conv_uuid)
            if header is None:
                raise HTTPException(status_code=404)
            messages = repository.conversation_messages(cursor, conv_uuid)
        # Outside the user transaction: the API role runs the SECURITY DEFINER lookup (0010).
        latest = turns.latest_turn(conn, user.user_id, conv_uuid)
    created_at, _store_id = header
    return Conversation(
        id=conv_uuid,
        created_at=created_at.astimezone(UTC),
        messages=messages,
        latest=latest,
    )


@router.post(
    "/conversations/{conversation_id}/escalations",
    response_model=TicketEnvelope,
)
def create_escalation(
    request: Request,
    response: Response,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    body: EscalationRequest,
    conversation_id: Annotated[str, Path(max_length=64)],
) -> TicketEnvelope:
    conv_uuid = _parse_id(conversation_id)
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        header = repository.conversation_header(cursor, conv_uuid)
        if header is None:
            raise HTTPException(status_code=404)
        _created_at, store_id = header
        ticket, created = repository.insert_ticket_once(
            cursor,
            store_id=store_id,
            user_id=user.user_id,
            conversation_id=conv_uuid,
            reason=body.reason,
            summary=body.summary,
            idempotency_key=body.idempotency_key,
        )
    response.status_code = 201 if created else 200
    return TicketEnvelope(ticket=ticket)


@router.get("/tickets", response_model=TicketList)
def list_own_tickets(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
) -> TicketList:
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        return TicketList(items=repository.own_tickets(cursor, user.user_id))


def _embedder(request: Request) -> Embedder | None:
    """The query embedder for hybrid retrieval, built once per app (None for keyword mode)."""
    state = request.app.state
    if not hasattr(state, "embedder"):
        state.embedder = build_embedder(state.settings)
    return cast(Embedder | None, state.embedder)


def _planner(request: Request) -> Planner:
    """The configured planner, built once per app. Raises AssistantUnavailable when none is set."""
    state = request.app.state
    cached: Planner | None = getattr(state, "planner", None)
    if cached is None:
        cached = build_planner(state.settings)
        state.planner = cached
    return cached


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=TurnEnvelope,
)
def post_message(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    body: TurnRequest,
    conversation_id: Annotated[str, Path(max_length=64)],
) -> TurnEnvelope:
    """One customer turn. Idempotent per (conversation, client_message_id)."""
    conv_uuid = _parse_id(conversation_id)
    settings: Settings = request.app.state.settings
    with db_session.connect(settings) as conn:
        with db_session.user_transaction(conn, user.user_id) as cursor:
            if repository.conversation_header(cursor, conv_uuid) is None:
                raise HTTPException(status_code=404)
        stored = turns.stored_envelope(conn, user.user_id, conv_uuid, body.client_message_id)
        if stored is not None:
            # A retry: no new message, no rate-limit charge, no second ticket.
            return TurnEnvelope.model_validate(stored)
        planner = _planner(request)
        turns.enforce_rate_limit(conn, settings, user.user_id)
        try:
            with db_session.user_transaction(conn, user.user_id) as cursor:
                turns.insert_user_message(cursor, conv_uuid, body.client_message_id, body.content)
        except turns.ConflictingClientMessage:
            raise HTTPException(status_code=409) from None
        message_id = uuid.uuid4()
        result = run_turn(
            conn,
            TurnInput(
                user_id=user.user_id,
                conversation_id=conv_uuid,
                client_message_id=body.client_message_id,
                content=body.content,
                filters=body.filters,
            ),
            planner=planner,
            max_tool_calls=settings.max_tool_calls,
            embedder=_embedder(request),
        )
        envelope = TurnEnvelope(
            message_id=message_id,
            answer=result.answer,
            next_action=result.next_action,  # type: ignore[arg-type]
            citations=list(result.citations),
            products=list(result.products),
            filters=result.filters,
            order=result.order,
            ticket=result.ticket,
            provider=result.provider,  # type: ignore[arg-type]
        )
        stored = turns.store_envelope(
            conn,
            user.user_id,
            conv_uuid,
            body.client_message_id,
            message_id,
            envelope.answer,
            envelope.model_dump(mode="json"),
        )
    return TurnEnvelope.model_validate(stored)
