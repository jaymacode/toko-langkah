"""Server-side tool execution for one turn.

The ToolRunner is the only path from a planner (rules or model) to the database. It:
- accepts only the tool names in MODEL_TOOLS, and validates arguments with tools.py models
  (extra fields such as user_id or store_id are rejected, not ignored);
- enforces MAX_TOOL_CALLS executions per turn;
- takes identity from the verified user id and scope from the server, never from arguments;
- records what it retrieved, so citations, products and orders are the server's facts, not
  model text. Retrieved text is data.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any, Final

import psycopg
from pydantic import ValidationError

from tokolangkah_api.assistant.errors import ToolBudgetExceeded, ToolRejected
from tokolangkah_api.assistant.policies import Evidence, search_policies
from tokolangkah_api.assistant.products import ProductHit, search_products
from tokolangkah_api.assistant.query_parser import MAX_KEYWORDS, ProductFilters, parse_product_query
from tokolangkah_api.assistant.tools import (
    TOOL_ARGUMENT_MODELS,
    GetOrderStatusArgs,
    SearchPoliciesArgs,
    SearchProductsArgs,
)
from tokolangkah_api.conversations import repository as conversation_repository
from tokolangkah_api.conversations.models import Ticket
from tokolangkah_api.db_session import user_transaction
from tokolangkah_api.orders import repository as order_repository
from tokolangkah_api.orders.models import Order

# Only these tools are offered to a model planner. create_escalation is server-only (escalate()).
MODEL_TOOLS: Final = frozenset({"search_products", "search_policies", "get_order_status"})
ESCALATION_REASON: Final = "Pelanggan meminta bantuan staf"
ESCALATION_SUMMARY_CHARS: Final = 1000


def merge_filters(base: ProductFilters | None, parsed: ProductFilters) -> ProductFilters:
    """Chips the customer already has (base) plus what this message states (parsed).

    Newly stated fields override. A new price operator replaces the old one (both bounds come from
    the parsed message). Keywords accumulate, capped. unparsed_budget is never carried over.
    """
    current = base or ProductFilters()
    has_price = parsed.price_lt is not None or parsed.price_lte is not None
    keywords = list(dict.fromkeys([*current.keywords, *parsed.keywords]))[:MAX_KEYWORDS]
    return ProductFilters(
        category=parsed.category or current.category,
        price_lt=parsed.price_lt if has_price else current.price_lt,
        price_lte=parsed.price_lte if has_price else current.price_lte,
        size_eu=parsed.size_eu or current.size_eu,
        color=parsed.color or current.color,
        keywords=keywords,
        unparsed_budget=None,
    )


def constrain_to_stated(planner: ProductFilters, stated: ProductFilters) -> ProductFilters:
    """Keep the planner's keywords/category; take every hard bound from the customer's message."""
    return ProductFilters(
        category=stated.category or planner.category,
        price_lt=stated.price_lt,
        price_lte=stated.price_lte,
        size_eu=stated.size_eu,
        color=stated.color,
        keywords=list(dict.fromkeys([*stated.keywords, *planner.keywords]))[:MAX_KEYWORDS],
        unparsed_budget=None,
    )


def escalation_key(conversation_id: uuid.UUID, client_message_id: uuid.UUID) -> str:
    """Idempotency key derived on the server from the conversation and the client message id."""
    return f"turn-{conversation_id}-{client_message_id}"


class ToolRunner:
    def __init__(
        self,
        conn: psycopg.Connection[Any],
        *,
        max_calls: int,
        user_id: uuid.UUID | None,
        conversation_id: uuid.UUID | None = None,
        client_message_id: uuid.UUID | None = None,
        base_filters: ProductFilters | None = None,
        user_text: str | None = None,
    ) -> None:
        self._conn = conn
        self.max_calls = max_calls
        self.user_id = user_id
        self.conversation_id = conversation_id
        self.client_message_id = client_message_id
        self.base_filters = base_filters
        # Hard constraints (price operator, size, colour) come only from the customer's own words,
        # parsed deterministically. A planner-written query may add keywords/category, never bounds.
        self._stated = parse_product_query(user_text) if user_text is not None else None
        self.calls_made = 0
        self.outcomes: list[tuple[str, str]] = []
        self.evidence: dict[str, Evidence] = {}
        self.product_filters: ProductFilters | None = None
        self.products: list[ProductHit] | None = None
        self.order_checked = False
        self.order: Order | None = None
        self.ticket: Ticket | None = None

    def call(self, name: object, arguments: object) -> dict[str, Any]:
        """Validate and execute one model-proposed tool call. Returns JSON-safe data."""
        if not isinstance(name, str) or name not in MODEL_TOOLS:
            raise ToolRejected("unknown_tool")
        if not isinstance(arguments, Mapping):
            raise ToolRejected("invalid_arguments")
        model = TOOL_ARGUMENT_MODELS[name]
        try:
            parsed = model.model_validate(dict(arguments))
        except ValidationError:
            raise ToolRejected("invalid_arguments") from None
        if self.calls_made >= self.max_calls:
            raise ToolBudgetExceeded("tool_budget")
        self.calls_made += 1
        if isinstance(parsed, SearchPoliciesArgs):
            return self._search_policies(parsed)
        if isinstance(parsed, SearchProductsArgs):
            return self._search_products(parsed)
        if isinstance(parsed, GetOrderStatusArgs):
            return self._get_order_status(parsed)
        raise ToolRejected("unknown_tool")  # pragma: no cover - MODEL_TOOLS guards this

    def _search_policies(self, args: SearchPoliciesArgs) -> dict[str, Any]:
        found = search_policies(self._conn, args.query, args.limit)
        for item in found:
            self.evidence.setdefault(item.chunk_id, item)
        self.outcomes.append(("search_policies", "ok"))
        return {"results": [item.model_dump() for item in found]}

    def _constrain(self, from_planner: ProductFilters) -> ProductFilters:
        if self._stated is None:
            return from_planner
        return constrain_to_stated(from_planner, self._stated)

    def _search_products(self, args: SearchProductsArgs) -> dict[str, Any]:
        effective = merge_filters(
            self.base_filters, self._constrain(parse_product_query(args.query))
        )
        hits = search_products(self._conn, effective, args.limit)
        self.product_filters = effective
        self.products = hits
        self.outcomes.append(("search_products", "ok"))
        return {
            "filters": effective.model_dump(exclude={"unparsed_budget"}),
            "results": [hit.model_dump() for hit in hits],
        }

    def _get_order_status(self, args: GetOrderStatusArgs) -> dict[str, Any]:
        if self.user_id is None:
            raise ToolRejected("no_identity")
        with user_transaction(self._conn, self.user_id) as cursor:
            order = order_repository.get_order(cursor, args.order_number)
        self.order_checked = True
        self.order = order
        self.outcomes.append(("get_order_status", "found" if order else "not_found"))
        return {
            "found": order is not None,
            "order": order.model_dump(mode="json") if order is not None else None,
        }

    def escalate(self, summary: str) -> Ticket:
        """Create or return the escalation ticket for this client message (server-only path)."""
        if self.user_id is None or self.conversation_id is None or self.client_message_id is None:
            raise ToolRejected("no_identity")
        key = escalation_key(self.conversation_id, self.client_message_id)
        with user_transaction(self._conn, self.user_id) as cursor:
            header = conversation_repository.conversation_header(cursor, self.conversation_id)
            if header is None:
                raise ToolRejected("conversation_not_found")
            _created_at, store_id = header
            ticket, created = conversation_repository.insert_ticket_once(
                cursor,
                store_id=store_id,
                user_id=self.user_id,
                conversation_id=self.conversation_id,
                reason=ESCALATION_REASON,
                summary=summary[:ESCALATION_SUMMARY_CHARS],
                idempotency_key=key,
            )
        self.ticket = ticket
        self.outcomes.append(("create_escalation", "created" if created else "existing"))
        return ticket
