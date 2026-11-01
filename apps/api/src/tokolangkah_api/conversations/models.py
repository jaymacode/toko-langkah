"""Request and response models. Request models forbid unknown fields."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from tokolangkah_api.assistant.policies import Evidence
from tokolangkah_api.assistant.products import ProductHit
from tokolangkah_api.assistant.query_parser import ProductFilters
from tokolangkah_api.orders.models import Order

REASON_MAX = 200
SUMMARY_MAX = 1000
IDEMPOTENCY_KEY_MIN = 8
IDEMPOTENCY_KEY_MAX = 128


class ConversationCreated(BaseModel):
    id: uuid.UUID


class Message(BaseModel):
    role: str
    content: str
    created_at: datetime


class LatestTurn(BaseModel):
    """Filters and products of the newest assistant turn, for restoring the panel on reload.

    Only these two fields leave the server; the stored envelope has more, and the rest stays inside.
    """

    model_config = ConfigDict(extra="ignore")

    filters: ProductFilters | None
    products: list[ProductHit]


class Conversation(BaseModel):
    id: uuid.UUID
    created_at: datetime
    messages: list[Message]
    latest: LatestTurn | None = None
    # The unresolved ticket while staff handles this conversation (the assistant is off), else None.
    handoff: Ticket | None = None


class EscalationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Annotated[str, StringConstraints(min_length=1, max_length=REASON_MAX)]
    summary: Annotated[str, StringConstraints(min_length=1, max_length=SUMMARY_MAX)]
    idempotency_key: Annotated[
        str,
        StringConstraints(min_length=IDEMPOTENCY_KEY_MIN, max_length=IDEMPOTENCY_KEY_MAX),
    ] = Field(...)

    @field_validator("reason", "summary")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class Ticket(BaseModel):
    id: uuid.UUID
    status: str
    reason: str
    summary: str
    created_at: datetime
    updated_at: datetime


class TicketEnvelope(BaseModel):
    ticket: Ticket


class TicketList(BaseModel):
    items: list[Ticket]


MESSAGE_MAX_CHARS = 2000


class TurnRequest(BaseModel):
    """One customer message. `filters` are the chips the customer currently has (their input)."""

    model_config = ConfigDict(extra="forbid")

    content: Annotated[str, StringConstraints(min_length=1, max_length=MESSAGE_MAX_CHARS)]
    client_message_id: uuid.UUID
    filters: ProductFilters | None = None

    @field_validator("content")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class TurnEnvelope(BaseModel):
    """The assistant's reply. Stored verbatim as messages.payload for idempotent retries."""

    # Envelopes stored before 0011 carry no kind; they are assistant replies.
    kind: Literal["assistant"] = "assistant"
    message_id: uuid.UUID
    answer: str
    next_action: Literal["answer", "clarify", "abstain", "offer_escalation", "escalated"]
    citations: list[Evidence]
    products: list[ProductHit]
    filters: ProductFilters | None
    order: Order | None
    ticket: Ticket | None
    provider: str
    # The customer's own orders for a list question; absent on envelopes stored before it existed.
    orders: list[Order] = Field(default_factory=list)


class StaffRelay(BaseModel):
    """Reply to a customer message sent while staff handles the conversation.

    The assistant did not run: the message is in the transcript for staff to answer.
    """

    kind: Literal["staff"] = "staff"
    ticket: Ticket
