"""USD spend control for live model calls.

One ledger (table tokolangkah_private.provider_spend, migration 0008) counts every live call from
chat turns and live evals against LIVE_EVAL_BUDGET_USD. Costs are estimates from configured
prices (conservative defaults in settings.py), not invoices.

The ledger is written on its own autocommit connection, so a spend record survives a turn that
later fails and rolls back. Failures to read or write the ledger fail closed (AssistantUnavailable).
Only the request-independent facts are stored: source, model, token counts, cost and a random id.
Never prompts, answers or keys.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from decimal import ROUND_UP, Decimal
from typing import Any, Final, Literal, Protocol

import psycopg

from tokolangkah_api.assistant.errors import AssistantUnavailable

Source = Literal["chat", "eval", "ingest"]

# Conservative: real tokenisers usually give fewer tokens than one per three characters.
CHARS_PER_TOKEN: Final = 3
PER_MILLION: Final = Decimal("1000000")
COST_QUANTUM: Final = Decimal("0.000001")  # matches numeric(12,6) in the ledger
LEDGER_CONNECT_TIMEOUT_SECONDS: Final = 5

_TOTAL_SQL: Final = "SELECT tokolangkah_private.provider_spend_total()"
_RECORD_SQL: Final = (
    "SELECT tokolangkah_private.record_provider_spend("
    "%s::text, %s::text, %s::integer, %s::integer, %s::numeric, %s::text)"
)


def estimate_cost(
    input_tokens: int,
    output_tokens: int,
    price_input_per_mtok: Decimal,
    price_output_per_mtok: Decimal,
) -> Decimal:
    """Estimated USD for one call, rounded up to the ledger's precision (never under-counted)."""
    raw = (
        Decimal(input_tokens) * price_input_per_mtok
        + Decimal(output_tokens) * price_output_per_mtok
    ) / PER_MILLION
    return raw.quantize(COST_QUANTUM, rounding=ROUND_UP)


def estimate_input_tokens(*payloads: Any) -> int:
    """Approximate input tokens of a request: serialised characters divided by CHARS_PER_TOKEN."""
    text = json.dumps(payloads, ensure_ascii=False, default=str)
    return math.ceil(len(text) / CHARS_PER_TOKEN)


class SpendLedger(Protocol):
    def total_usd(self) -> Decimal: ...

    def record(
        self,
        *,
        source: Source,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: Decimal,
        request_id: str,
    ) -> None: ...


class DbSpendLedger:
    """The shared ledger in PostgreSQL. Each call uses a short autocommit connection."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def total_usd(self) -> Decimal:
        try:
            with psycopg.connect(
                self._database_url, connect_timeout=LEDGER_CONNECT_TIMEOUT_SECONDS, autocommit=True
            ) as conn:
                row = conn.execute(_TOTAL_SQL).fetchone()
        except psycopg.Error:
            # Class name only: driver messages can contain the connection string.
            raise AssistantUnavailable("spend_ledger") from None
        if row is None or row[0] is None:
            return Decimal("0")
        return Decimal(str(row[0]))

    def record(
        self,
        *,
        source: Source,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: Decimal,
        request_id: str,
    ) -> None:
        try:
            with psycopg.connect(
                self._database_url, connect_timeout=LEDGER_CONNECT_TIMEOUT_SECONDS, autocommit=True
            ) as conn:
                conn.execute(
                    _RECORD_SQL,
                    (source, model, input_tokens, output_tokens, cost_usd, request_id),
                )
        except psycopg.Error:
            raise AssistantUnavailable("spend_ledger") from None


class UnavailableLedger:
    """Used when no database is configured: every model call is refused (fail closed)."""

    def total_usd(self) -> Decimal:
        raise AssistantUnavailable("spend_ledger")

    def record(
        self,
        *,
        source: Source,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: Decimal,
        request_id: str,
    ) -> None:
        raise AssistantUnavailable("spend_ledger")


@dataclass(frozen=True)
class SpendPolicy:
    """Everything the planner needs to guard and record one source's model calls."""

    source: Source
    ledger: SpendLedger
    budget_usd: Decimal
    price_input_per_mtok: Decimal
    price_output_per_mtok: Decimal
    max_output_tokens: int

    def cost(self, input_tokens: int, output_tokens: int) -> Decimal:
        return estimate_cost(
            input_tokens, output_tokens, self.price_input_per_mtok, self.price_output_per_mtok
        )

    def worst_case(self, input_tokens: int) -> Decimal:
        """Cost if the next call used every allowed output token."""
        return self.cost(input_tokens, self.max_output_tokens)
