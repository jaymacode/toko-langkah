"""Deterministic Indonesian heuristics shared by the planner and the orchestrator's pre-routing.

These decide routing only. Authorization is enforced by the ToolRunner and by RLS, never by these.
"""

from __future__ import annotations

import re
from typing import Final, Literal

from tokolangkah_api.assistant.query_parser import ProductFilters
from tokolangkah_api.orders.models import ORDER_NUMBER_PATTERN

# A handoff needs a request verb before the target ("mau bicara dengan staf", "hubungi CS"), so a
# question ABOUT support ("Jam layanan bantuan manusia kapan?") stays a policy question. Found by
# the 2026-10-28 live eval (policy-10/11/12 opened tickets nobody asked for).
_HANDOFF_RE: Final = re.compile(
    r"\b(?:bicara|berbicara|ngobrol|chat|hubungi|hubungkan|sambungkan|disambungkan|dihubungkan"
    r"|minta|butuh|panggil|oper|teruskan)\b[^.?!\n]{0,40}?"
    r"\b(?:staf|staff|manusia|cs|customer\s+service|admin|orang\s+asli|petugas|operator)\b",
    re.IGNORECASE,
)
_SUPPORT_QUESTION_RE: Final = re.compile(r"\b(?:jam|kapan|hari\s+apa)\b", re.IGNORECASE)
_ORDER_WORDS_RE: Final = re.compile(
    r"\b(?:pesanan|pesananku|order|orderku|status|lacak|resi|paket|paketku)\b", re.IGNORECASE
)
_ORDER_CANDIDATE_RE: Final = re.compile(
    r"(?<![A-Za-z0-9-])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+(?![A-Za-z0-9-])"
)
_ORDER_NUMBER_RE: Final = re.compile(ORDER_NUMBER_PATTERN)
_TOKEN_RE: Final = re.compile(r"[a-z]+")
# "My orders" rather than a question about how orders work in general.
_MY_ORDERS_RE: Final = re.compile(
    r"\b(?:saya|aku|gue|gw|punyaku|pesananku|orderku|milikku)\b"
    r"|\b(?:apa\s+(?:saja|aja)|semua|daftar|riwayat|cek|lihat|mana\s+saja|mana\s+aja)\b",
    re.IGNORECASE,
)
_NOT_DELIVERED_RE: Final = re.compile(
    r"\bbelum\s+(?:sampai|diterima|datang|tiba|nyampe|nyampai)\b"
    r"|\b(?:dalam\s+perjalanan|masih\s+di\s+jalan|sedang\s+dikirim|masih\s+dikirim)\b",
    re.IGNORECASE,
)
_DELIVERED_RE: Final = re.compile(
    r"\b(?:sudah|udah)\s+(?:sampai|diterima|datang|tiba|nyampe)\b", re.IGNORECASE
)
_CANCELLED_RE: Final = re.compile(r"\b(?:batal|dibatalkan|pembatalan)\b", re.IGNORECASE)

OrderGroup = Literal["all", "not_delivered", "delivered", "cancelled"]

POLICY_TRIGGERS: Final = frozenset(
    {
        "retur", "pengembalian", "penukaran", "tukar", "garansi", "ongkir", "pengiriman",
        "kirim", "bayar", "pembayaran", "pasti", "sampai", "tiba", "jaminan", "jamin",
        "tahan", "kebijakan", "syarat", "ketentuan", "restock", "label", "promo", "estimasi",
        "pembatalan", "batal",
    }
)  # fmt: skip
GUARANTEE_TOKENS: Final = frozenset(
    {
        "pasti",
        "jamin",
        "dijamin",
        "jaminan",
        "waterproof",
        "medis",
        "garansi",
        "garansinya",
        "seumur",
    }
)
PRODUCT_KEYWORDS: Final = frozenset(
    {
        "jalan jauh", "walking", "trail", "outdoor", "jalur tanah", "kanvas", "canvas", "rajut",
        "knit", "kasual", "harian", "mesh", "ringan",
    }
)  # fmt: skip


def is_handoff_request(text: str) -> bool:
    if _SUPPORT_QUESTION_RE.search(text):
        return False
    return _HANDOFF_RE.search(text) is not None


def find_order_number(text: str) -> str | None:
    """First token shaped like an order number (upper-cased), or None."""
    for match in _ORDER_CANDIDATE_RE.finditer(text):
        candidate = match.group(0).upper()
        if _ORDER_NUMBER_RE.fullmatch(candidate) and any(c.isdigit() for c in candidate):
            return candidate
    return None


def wants_order_status(text: str) -> bool:
    return _ORDER_WORDS_RE.search(text) is not None or find_order_number(text) is not None


def wants_my_orders(text: str) -> bool:
    """The customer asks about their own orders (list or status), not about order policy."""
    return _MY_ORDERS_RE.search(text) is not None or order_group(text) != "all"


def order_group(text: str) -> OrderGroup:
    """Which of the customer's orders the question is about. Routing only, never authorization."""
    if _NOT_DELIVERED_RE.search(text):
        return "not_delivered"
    if _DELIVERED_RE.search(text):
        return "delivered"
    if _CANCELLED_RE.search(text):
        return "cancelled"
    return "all"


def looks_like_policy(text: str) -> bool:
    return bool(POLICY_TRIGGERS.intersection(_TOKEN_RE.findall(text.lower())))


def is_guarantee_request(text: str) -> bool:
    lowered = text.lower()
    return bool(GUARANTEE_TOKENS.intersection(_TOKEN_RE.findall(lowered))) or "tahan air" in lowered


def has_strong_product_signal(parsed: ProductFilters) -> bool:
    return bool(
        parsed.category
        or parsed.price_lt is not None
        or parsed.price_lte is not None
        or parsed.size_eu is not None
        or parsed.color
    )


def has_narrowing_product_signal(parsed: ProductFilters) -> bool:
    """A price, size or colour: the customer is searching for products, not asking about policy."""
    return bool(
        parsed.price_lt is not None
        or parsed.price_lte is not None
        or parsed.size_eu is not None
        or parsed.color
    )


def has_product_signal(parsed: ProductFilters) -> bool:
    return has_strong_product_signal(parsed) or any(
        keyword in PRODUCT_KEYWORDS for keyword in parsed.keywords
    )
