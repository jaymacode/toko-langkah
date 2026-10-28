"""Argument models for the assistant's tools. Schemas and validation only; no execution here.

Every model forbids extra fields, so a model-supplied identity (user_id, store_id, role, ...)
is rejected instead of silently ignored. Identity comes only from the verified token (round 4).
"""

from __future__ import annotations

from typing import Annotated, Any, Final, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

MAX_TOOL_QUERY_CHARS: Final = 500
ORDER_NUMBER_PATTERN: Final = r"^[A-Z0-9-]{3,32}$"

QueryText = Annotated[str, StringConstraints(min_length=1, max_length=MAX_TOOL_QUERY_CHARS)]
OrderNumber = Annotated[str, StringConstraints(pattern=ORDER_NUMBER_PATTERN)]


class SearchProductsArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: QueryText
    limit: int = Field(default=5, ge=1, le=10)


class SearchPoliciesArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: QueryText
    limit: int = Field(default=5, ge=1, le=5)


class GetOrderStatusArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_number: OrderNumber


class ListMyOrdersArgs(BaseModel):
    """The signed-in customer's own orders. No identity argument: it comes from the token."""

    model_config = ConfigDict(extra="forbid")

    status_group: Literal["all", "not_delivered", "delivered", "cancelled"] = "all"


class CreateEscalationArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    reason: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    summary: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    idempotency_key: Annotated[str, StringConstraints(min_length=8, max_length=128)]


TOOL_ARGUMENT_MODELS: Final[dict[str, type[BaseModel]]] = {
    "search_products": SearchProductsArgs,
    "search_policies": SearchPoliciesArgs,
    "get_order_status": GetOrderStatusArgs,
    "list_my_orders": ListMyOrdersArgs,
    "create_escalation": CreateEscalationArgs,
}


def tool_json_schemas() -> dict[str, dict[str, Any]]:
    """JSON Schema for each tool's arguments, keyed by tool name."""
    return {name: model.model_json_schema() for name, model in TOOL_ARGUMENT_MODELS.items()}
