"""One assistant turn: deterministic pre-routing, the planner, validation, and the answer envelope.

Pre-routing (same for every provider):
- a staff/human request creates an escalation through ToolRunner.escalate (idempotent per client
  message);
- an amount with no operator word ("budget 500rb") is never applied; the customer is asked which
  operator they mean.
Everything else goes to the planner. Answers are plain text built from validated claims or from
server-recorded facts with fixed templates. Model text is never shown without citation validation.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, Final

import psycopg

from tokolangkah_api.assistant.citations import Claim, normalized_tokens, validate_claims
from tokolangkah_api.assistant.errors import AssistantError, AssistantUnavailable
from tokolangkah_api.assistant.intent import (
    is_guarantee_request,
    is_handoff_request,
    looks_like_policy,
)
from tokolangkah_api.assistant.planner import Planner
from tokolangkah_api.assistant.policies import Evidence, policy_terms
from tokolangkah_api.assistant.products import ProductHit
from tokolangkah_api.assistant.query_parser import ProductFilters, parse_product_query
from tokolangkah_api.assistant.runtime import ToolRunner
from tokolangkah_api.auth import user_hash
from tokolangkah_api.conversations.models import Ticket
from tokolangkah_api.orders.models import Order

logger = logging.getLogger(__name__)

MAX_TOOL_QUERY_CHARS: Final = 500

STATUS_LABELS: Final[dict[str, str]] = {
    "processing": "sedang diproses",
    "shipped": "sudah dikirim",
    "delivered": "sudah diterima",
    "cancelled": "dibatalkan",
}
CONFLICT_TEXT: Final = (
    "Ada ketentuan toko yang tampaknya berbeda untuk pertanyaan ini, sehingga saya tidak bisa "
    "memastikan jawabannya. Anda bisa menghubungi staf untuk dicek."
)
ABSTAIN_TEXT: Final = (
    "Saya belum menemukan ketentuan toko yang mendukung jawaban atas pertanyaan ini. "
    "Anda bisa menghubungi staf untuk bantuan lebih lanjut."
)
GUARANTEE_NOTE: Final = (
    "Saya tidak dapat memberikan jaminan di luar ketentuan tertulis di atas. "
    "Hubungi staf jika Anda memerlukan kepastian."
)
GENERIC_CLARIFY: Final = (
    "Apakah Anda sedang mencari sepatu, atau ingin bertanya tentang kebijakan toko "
    "(retur, pengiriman, pembayaran)?"
)
ORDER_CLARIFY: Final = (
    "Sebutkan nomor pesanan Anda, misalnya dalam format DEMO-1001, "
    "agar saya bisa memeriksa statusnya."
)
ORDER_NOT_FOUND: Final = "Pesanan tidak ditemukan. Periksa kembali nomor pesanan Anda."
HANDOFF_TEXT: Final = (
    "Permintaan Anda sudah diteruskan ke staf. Nomor tiket: {ticket_id}. Status: {status}."
)
# Conversational filler that says nothing about the topic of a policy question.
RELEVANCE_IGNORED_TERMS: Final = frozenset({"kan", "nya", "hari", "toko", "tolong", "kak", "min"})
TICKET_STATUS_LABELS: Final = {"open": "Terbuka", "in_progress": "Ditangani", "resolved": "Selesai"}


@dataclass(frozen=True)
class TurnInput:
    user_id: uuid.UUID
    conversation_id: uuid.UUID
    client_message_id: uuid.UUID
    content: str
    filters: ProductFilters | None


@dataclass(frozen=True)
class TurnResult:
    answer: str
    next_action: str
    citations: tuple[Evidence, ...]
    products: tuple[ProductHit, ...]
    filters: ProductFilters | None
    order: Order | None
    ticket: Ticket | None
    provider: str


def format_idr(amount: int) -> str:
    return "Rp " + f"{amount:,}".replace(",", ".")


def describe_filters(filters: ProductFilters | None) -> str:
    if filters is None:
        return "tanpa filter khusus"
    parts: list[str] = []
    if filters.category:
        parts.append(f"kategori {filters.category}")
    if filters.price_lt is not None:
        parts.append(f"harga di bawah {format_idr(filters.price_lt)}")
    if filters.price_lte is not None:
        parts.append(f"harga maksimal {format_idr(filters.price_lte)}")
    if filters.size_eu is not None:
        parts.append(f"ukuran EU {filters.size_eu}")
    if filters.color:
        parts.append(f"warna {filters.color}")
    if filters.keywords:
        parts.append("kata kunci " + ", ".join(filters.keywords))
    return ", ".join(parts) if parts else "tanpa filter khusus"


def _order_answer(order: Order) -> str:
    label = STATUS_LABELS.get(order.status, order.status)
    text = f"Pesanan {order.order_number}: status {label}."
    if order.tracking_code:
        text += f" Nomor resi: {order.tracking_code}."
    if order.eta_text:
        text += f" {order.eta_text}"
    return text


def _product_answer(products: list[ProductHit]) -> str:
    return f"Ada {len(products)} produk yang sesuai dengan filter aktif."


def _no_product_answer(filters: ProductFilters) -> str:
    return (
        f"Tidak ada produk yang cocok dengan filter aktif ({describe_filters(filters)}). "
        "Saya belum melonggarkan filter. Apakah Anda ingin mencari dengan budget atau syarat "
        "yang lebih longgar?"
    )


def _budget_clarify(amount: int) -> str:
    return f"Maksudnya di bawah atau maksimal {format_idr(amount)}?"


def run_turn(
    conn: psycopg.Connection[Any],
    turn: TurnInput,
    *,
    planner: Planner,
    max_tool_calls: int,
) -> TurnResult:
    started = time.monotonic()
    tools = ToolRunner(
        conn,
        max_calls=max_tool_calls,
        user_id=turn.user_id,
        conversation_id=turn.conversation_id,
        client_message_id=turn.client_message_id,
        base_filters=turn.filters,
        user_text=turn.content,
    )
    try:
        result = _route(turn, planner, tools)
    except AssistantUnavailable:
        _log(planner.name, "unavailable", turn, tools, started)
        raise
    except AssistantError as exc:
        _log(planner.name, "unavailable", turn, tools, started)
        raise AssistantUnavailable(type(exc).__name__) from None
    except psycopg.Error:
        # Database failures keep their own envelope (service_unavailable); nothing is answered.
        raise
    except Exception as exc:
        # A planner or tool bug must never surface as an answer or a 500 with details: the turn is
        # reported unavailable, and the stored user message stays so the same client_message_id
        # can be retried. Only the exception class is logged.
        logger.warning("planner failure type=%s provider=%s", type(exc).__name__, planner.name)
        _log(planner.name, "unavailable", turn, tools, started)
        raise AssistantUnavailable("planner_error") from exc
    _log(planner.name, result.next_action, turn, tools, started)
    return result


def _route(turn: TurnInput, planner: Planner, tools: ToolRunner) -> TurnResult:
    content = turn.content
    parsed = parse_product_query(content[:MAX_TOOL_QUERY_CHARS])
    base = turn.filters

    if is_handoff_request(content):
        ticket = tools.escalate(content)
        return _ticket_result(ticket, planner.name, base)

    if parsed.unparsed_budget is not None and not looks_like_policy(content):
        return _clarify_result(_budget_clarify(parsed.unparsed_budget), planner.name, base)

    decision = planner.plan(content, tools)
    if decision.intent == "abstain":
        return _abstain_result(planner.name, base)
    if decision.intent == "policy":
        return _policy_result(content, decision.claims, tools, planner.name, base)
    if decision.intent == "product":
        if tools.products is None:
            return _clarify_result(GENERIC_CLARIFY, planner.name, base)
        effective = tools.product_filters
        if not tools.products:
            return TurnResult(
                answer=_no_product_answer(effective or ProductFilters()),
                next_action="clarify",
                citations=(),
                products=(),
                filters=effective,
                order=None,
                ticket=None,
                provider=planner.name,
            )
        return TurnResult(
            answer=_product_answer(tools.products),
            next_action="answer",
            citations=(),
            products=tuple(tools.products),
            filters=effective,
            order=None,
            ticket=None,
            provider=planner.name,
        )
    if decision.intent == "order":
        if not tools.order_checked:
            return _clarify_result(ORDER_CLARIFY, planner.name, base)
        if tools.order is None:
            return _answer_result(ORDER_NOT_FOUND, planner.name, base)
        return TurnResult(
            answer=_order_answer(tools.order),
            next_action="answer",
            citations=(),
            products=(),
            filters=base,
            order=tools.order,
            ticket=None,
            provider=planner.name,
        )
    if decision.clarify_reason == "order_number_missing":
        return _clarify_result(ORDER_CLARIFY, planner.name, base)
    return _clarify_result(GENERIC_CLARIFY, planner.name, base)


def addresses_question(content: str, citations: tuple[Evidence, ...]) -> bool:
    """True when at least one topical query term (synonyms expanded) occurs in a cited excerpt.

    A question with no topical terms is not judged here (the citation validator still applies).
    """
    terms = set(policy_terms(content)) - RELEVANCE_IGNORED_TERMS
    if not terms:
        return True
    cited_tokens: set[str] = set()
    for item in citations:
        cited_tokens |= normalized_tokens(f"{item.title} {item.section} {item.excerpt}")
    return bool(terms & cited_tokens)


def _abstain_result(provider: str, base: ProductFilters | None) -> TurnResult:
    return TurnResult(
        answer=ABSTAIN_TEXT,
        next_action="abstain",
        citations=(),
        products=(),
        filters=base,
        order=None,
        ticket=None,
        provider=provider,
    )


def _policy_result(
    content: str,
    claims: tuple[Claim, ...],
    tools: ToolRunner,
    provider: str,
    base: ProductFilters | None,
) -> TurnResult:
    validated = validate_claims(claims, tools.evidence)
    if validated.abstained:
        return _abstain_result(provider, base)
    citations = tuple(tools.evidence[citation_id] for citation_id in validated.citation_ids)
    if not addresses_question(content, citations):
        # Supported-but-irrelevant quotes (e.g. a returns sentence for a lifetime-warranty
        # question) are not an answer: abstain and offer staff instead.
        return _abstain_result(provider, base)
    # Sentences from two different policies may disagree (conflicting active policies). The
    # assistant cannot tell which applies, so it shows no claim and offers staff review.
    if len({item.title for item in citations}) > 1:
        return TurnResult(
            answer=CONFLICT_TEXT,
            next_action="offer_escalation",
            citations=citations,
            products=(),
            filters=base,
            order=None,
            ticket=None,
            provider=provider,
        )
    answer = validated.text
    if is_guarantee_request(content):
        return TurnResult(
            answer=f"{answer} {GUARANTEE_NOTE}",
            next_action="offer_escalation",
            citations=citations,
            products=(),
            filters=base,
            order=None,
            ticket=None,
            provider=provider,
        )
    return TurnResult(
        answer=answer,
        next_action="answer",
        citations=citations,
        products=(),
        filters=base,
        order=None,
        ticket=None,
        provider=provider,
    )


def _ticket_result(ticket: Ticket, provider: str, base: ProductFilters | None) -> TurnResult:
    return TurnResult(
        answer=HANDOFF_TEXT.format(
            ticket_id=ticket.id, status=TICKET_STATUS_LABELS.get(ticket.status, ticket.status)
        ),
        next_action="escalated",
        citations=(),
        products=(),
        filters=base,
        order=None,
        ticket=ticket,
        provider=provider,
    )


def _clarify_result(text: str, provider: str, base: ProductFilters | None) -> TurnResult:
    return _answer_result(text, provider, base, next_action="clarify")


def _answer_result(
    text: str, provider: str, base: ProductFilters | None, next_action: str = "answer"
) -> TurnResult:
    return TurnResult(
        answer=text,
        next_action=next_action,
        citations=(),
        products=(),
        filters=base,
        order=None,
        ticket=None,
        provider=provider,
    )


def _log(provider: str, outcome: str, turn: TurnInput, tools: ToolRunner, started: float) -> None:
    # Logged: provider, outcome, tool names with outcome codes, latency, hashed user. Never the
    # message content, the answer, excerpts or tokens.
    latency_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "assistant turn provider=%s outcome=%s tools=%s latency_ms=%d user=%s",
        provider,
        outcome,
        ",".join(f"{name}:{code}" for name, code in tools.outcomes) or "none",
        latency_ms,
        user_hash(turn.user_id),
    )
