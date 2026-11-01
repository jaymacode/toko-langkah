"""Planner contract for the model planner (OpenAI-compatible endpoint).

A planner decides the intent of one message and runs retrieval through the ToolRunner. It returns
claims for policy answers only; each claim is validated by citations.validate_claims before it
can be shown. Products, orders and tickets are read from the ToolRunner's recorded results,
not from text.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from tokolangkah_api.assistant.citations import Claim
from tokolangkah_api.assistant.runtime import ToolRunner

Intent = Literal["policy", "product", "order", "orders", "clarify", "abstain"]


@dataclass(frozen=True)
class PlannerDecision:
    intent: Intent
    claims: tuple[Claim, ...] = field(default=())
    clarify_reason: Literal["generic", "order_number_missing"] = "generic"


class Planner(Protocol):
    @property
    def name(self) -> str: ...

    def plan(self, content: str, tools: ToolRunner) -> PlannerDecision: ...
