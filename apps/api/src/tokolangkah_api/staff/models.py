"""Response and request models for /me and the staff ticket endpoints.

Customer aliases are exposed to staff. Auth user ids are never exposed, except the caller's own
user_id in /me.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from tokolangkah_api.conversations.models import Message, Ticket

TicketStatus = Literal["open", "in_progress", "resolved"]


class MeResponse(BaseModel):
    user_id: uuid.UUID
    customer_stores: list[str]
    staff_stores: list[str]


class StaffTicket(Ticket):
    customer_alias: str


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
