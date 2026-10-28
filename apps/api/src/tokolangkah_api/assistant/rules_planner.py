"""Deterministic rules planner. This is a demo planner, not AI: it lets the product work without
a model provider and lets the turn plumbing be tested. Every answer it produces is an extract of
retrieved text or a server-recorded fact. Its provider label is "rules" everywhere it is shown.
"""

from __future__ import annotations

import re
from typing import Final

from tokolangkah_api.assistant.citations import Claim, contains_order_reference, normalized_tokens
from tokolangkah_api.assistant.intent import (
    find_order_number,
    has_narrowing_product_signal,
    has_product_signal,
    looks_like_policy,
    order_group,
    wants_my_orders,
    wants_order_status,
)
from tokolangkah_api.assistant.planner import PlannerDecision
from tokolangkah_api.assistant.policies import Evidence, policy_terms
from tokolangkah_api.assistant.query_parser import parse_product_query
from tokolangkah_api.assistant.runtime import ToolRunner

MAX_POLICY_CLAIMS: Final = 3
MAX_POLICY_EVIDENCE: Final = 2
MAX_TOOL_QUERY_CHARS: Final = 500
_SENTENCE_SPLIT_RE: Final = re.compile(r"(?<=[.!?])\s+")


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in _SENTENCE_SPLIT_RE.split(text.strip()) if part.strip()]


def policy_claims(content: str, evidence: list[Evidence]) -> tuple[Claim, ...]:
    """Quote the policy section whose sentence best matches the query.

    The best-matching sentence picks the section; its sentences are then quoted verbatim in
    document order (up to MAX_POLICY_CLAIMS), because a policy section's conditions belong
    together (e.g. the return window AND the item-condition rules). Verbatim quoting keeps
    every claim supported by its own excerpt.
    """
    terms = set(policy_terms(content))
    scored: list[tuple[int, int, Claim, Evidence]] = []
    order = 0
    for item in evidence[:MAX_POLICY_EVIDENCE]:
        for sentence in split_sentences(item.excerpt):
            overlap = len(terms & normalized_tokens(sentence))
            if overlap > 0 and not contains_order_reference(sentence):
                scored.append((-overlap, order, Claim(sentence, (item.chunk_id,)), item))
            order += 1
    if not scored:
        return ()
    scored.sort(key=lambda entry: (entry[0], entry[1]))
    best = scored[0][0]
    top = [entry for entry in scored if entry[0] == best]
    if len({entry[3].title for entry in top}) > 1:
        # Equally strong matches from different policies: quote both best sentences so the
        # orchestrator's conflict rule (two titles cited) offers escalation instead of picking one.
        return tuple(entry[2] for entry in top[:MAX_POLICY_CLAIMS])
    chosen = top[0][3]
    sentences = [s for s in split_sentences(chosen.excerpt) if not contains_order_reference(s)]
    return tuple(Claim(s, (chosen.chunk_id,)) for s in sentences[:MAX_POLICY_CLAIMS])


class RulesPlanner:
    name: Final = "rules"

    def plan(self, content: str, tools: ToolRunner) -> PlannerDecision:
        query = content[:MAX_TOOL_QUERY_CHARS]
        if wants_order_status(content):
            number = find_order_number(content)
            if number is not None:
                tools.call("get_order_status", {"order_number": number})
                return PlannerDecision("order")
            if wants_my_orders(content):
                # "cek pesanan saya apa aja yang belum sampai": list the customer's own orders.
                tools.call("list_my_orders", {"status_group": order_group(content)})
                return PlannerDecision("orders")
            if not looks_like_policy(content):
                return PlannerDecision("clarify", clarify_reason="order_number_missing")
            # A general question about orders ("berapa lama pesanan diproses?") is a policy one.
        parsed = parse_product_query(query)
        # A property question ("tahan air?") stays on the policy path: a category word alone is
        # not a product search. Price, size or colour make it a product search.
        if looks_like_policy(content) and not has_narrowing_product_signal(parsed):
            tools.call("search_policies", {"query": query, "limit": 5})
            return PlannerDecision(
                "policy", claims=policy_claims(query, list(tools.evidence.values()))
            )
        if has_product_signal(parsed):
            tools.call("search_products", {"query": query, "limit": 5})
            return PlannerDecision("product")
        return PlannerDecision("clarify")
