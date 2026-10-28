"""Response and request models for /me and the staff ticket endpoints.

Customer aliases are exposed to staff. Auth user ids are never exposed, except the caller's own
user_id in /me.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from tokolangkah_api.conversations.models import MESSAGE_MAX_CHARS, Message, Ticket

TicketStatus = Literal["open", "in_progress", "resolved"]


class MeResponse(BaseModel):
    user_id: uuid.UUID
    customer_stores: list[str]
    staff_stores: list[str]


class StaffTicket(Ticket):
    customer_alias: str
    # Role of the newest transcript message ("user" means the customer is waiting for staff).
    last_message_role: str | None = None
    last_message_at: datetime | None = None


class StaffTicketList(BaseModel):
    items: list[StaffTicket]
    total: int


class AuditEvent(BaseModel):
    action: str
    created_at: datetime


class StaffTicketDetail(StaffTicket):
    transcript: list[Message]
    audit: list[AuditEvent]


class StatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: TicketStatus


class StaffReply(BaseModel):
    """One staff message in the ticket's conversation. Idempotent per client_message_id."""

    model_config = ConfigDict(extra="forbid")

    content: Annotated[str, StringConstraints(min_length=1, max_length=MESSAGE_MAX_CHARS)]
    client_message_id: uuid.UUID

    @field_validator("content")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class StaffReplyResult(BaseModel):
    message: Message
    ticket: Ticket


STOCK_MAX = 100_000


class InventoryVariant(BaseModel):
    id: str  # the variant SKU, e.g. "langkah-knit-40"
    size_eu: int
    stock: int


class InventoryProduct(BaseModel):
    slug: str
    name: str
    color: str | None
    price_idr: int
    image_path: str | None
    image_alt: str
    variants: list[InventoryVariant]


class InventoryList(BaseModel):
    """Stock counts for staff of the store only. Customers never receive counts (catalogue API)."""

    items: list[InventoryProduct]


class StockChange(BaseModel):
    """Set a variant's stock. expected_stock guards against overwriting another staff change."""

    model_config = ConfigDict(extra="forbid")

    stock: Annotated[int, Field(ge=0, le=STOCK_MAX, strict=True)]
    expected_stock: Annotated[int, Field(ge=0, le=STOCK_MAX, strict=True)] | None = None
