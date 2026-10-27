"""Conservative Indonesian parser for product search queries.

Rules:
- A price filter is set only when an explicit operator word sits directly before the amount.
  "di bawah" / "kurang dari" / "<" give price_lt (strict). "maksimal" / "maks" / "max" /
  "paling mahal" / "tidak lebih dari" / "sampai" / "<=" give price_lte (inclusive).
- An amount with no operator word is never applied as a price. It is returned as
  `unparsed_budget` so a later turn can ask the customer which operator they mean.
- A size is read only after an explicit word ("ukuran", "size", "nomor", "no"), and only 30-50 EU.
- Ambiguous amounts produce no filter: a unit with grouped digits ("1.500 ribu"), a decimal
  without a unit ("1,2"), or a bare small number ("40").
- Only the first price operator is used. Later amounts become `unparsed_budget`.
- Two or more different colours produce no colour filter.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from tokolangkah_api.assistant.errors import QueryParseError

MAX_QUERY_CHARS: Final = 500
MAX_KEYWORDS: Final = 8
MAX_IDR: Final = 100_000_000
# Plain digits with no "Rp" and no unit are money only at or above this value.
PLAIN_MONEY_MIN_IDR: Final = 10_000

COLOR_WORDS: Final[dict[str, str]] = {
    "hitam": "hitam",
    "putih": "putih",
    "krem": "krem",
    "sage": "sage",
    "navy": "navy",
    "charcoal": "charcoal",
    "oranye": "oranye",
    "orange": "oranye",
    "coklat": "coklat",
    "cokelat": "coklat",
}
CATEGORY_WORDS: Final[dict[str, str]] = {"sepatu": "sepatu"}
PHRASES: Final[tuple[tuple[str, str], ...]] = (
    (r"(?<![a-z])(?:berjalan|jalan)\s+jauh(?![a-z])", "jalan jauh"),
    (r"(?<![a-z])jalur\s+tanah(?![a-z])", "jalur tanah"),
)
STOPWORDS: Final[frozenset[str]] = frozenset(
    {
        "cari", "carikan", "tampilkan", "tunjukkan", "tunjukan", "buat", "untuk", "yang",
        "di", "ke", "dan", "atau", "ada", "saya", "aku", "mau", "ingin", "butuh", "minta",
        "tolong", "dong", "ya", "yg", "dengan", "dari", "murah", "bawah", "dibawah", "kurang",
        "maksimal", "maks", "max", "tidak", "lebih", "paling", "mahal", "budget", "rp", "ribu",
        "rb", "juta", "jt", "k", "sampai", "ukuran", "size", "nomor", "no", "eu", "tersedia",
        "apa", "bisa", "berapa", "ini", "itu", "sekitar", "harga", "saja", "aja", "warna",
        "the", "a", "an", "is", "kah", "apakah", "mana", "pakai", "boleh", "tanpa",
    }
)  # fmt: skip

_LT_OP = r"(?P<lt>di\s*bawah|kurang\s+dari|kurang|<(?!=))"
_LTE_OP = (
    r"(?P<lte>maksimal|maks\.?|max\.?|paling\s+mahal|tidak\s+(?:boleh\s+)?lebih\s+dari"
    r"|sampai|<=|≤)"
)
_RP = r"(?:\brp\.?\s*)?"
_NUM = r"(?P<num>\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)"
_UNIT = r"(?:\s*(?P<unit>ribu|rb|k|juta|jt)(?![a-z0-9]))?"
_GROUPED: Final = re.compile(r"\d{1,3}(?:[.,]\d{3})+")

_OP_AMOUNT_RE: Final = re.compile(
    rf"(?<![a-z0-9])(?:{_LT_OP}|{_LTE_OP})\s*{_RP}{_NUM}{_UNIT}(?![a-z0-9])"
)
_AMOUNT_RE: Final = re.compile(rf"(?<![a-z0-9]){_RP}{_NUM}{_UNIT}(?![a-z0-9])")
_SIZE_RE: Final = re.compile(
    r"(?<![a-z0-9])(?:ukuran|size|nomor|no\.?)\s*(?P<size>\d{2})(?:\s*eu)?(?![0-9])"
)
_TOKEN_RE: Final = re.compile(r"[a-z]+(?:-[a-z]+)*")


FilterText = Annotated[str, StringConstraints(min_length=1, max_length=40)]


class ProductFilters(BaseModel):
    """Parsed product-search constraints. Only these fields reach SQL, as bound parameters."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    category: FilterText | None = None
    price_lt: int | None = Field(default=None, ge=0, le=MAX_IDR)
    price_lte: int | None = Field(default=None, ge=0, le=MAX_IDR)
    size_eu: int | None = Field(default=None, ge=30, le=50)
    color: FilterText | None = None
    keywords: list[FilterText] = Field(default_factory=list, max_length=MAX_KEYWORDS)
    # An amount with no operator word. Never applied as a filter; the assistant must ask.
    unparsed_budget: int | None = Field(default=None, ge=0, le=MAX_IDR)


def _to_idr(num: str, unit: str | None, has_rp: bool) -> int | None:
    """Return integer IDR for a matched amount, or None when the reading is not safe to use."""
    if unit is not None:
        if _GROUPED.fullmatch(num):
            return None  # "1.500 ribu" could mean 1.5 or 1500: ambiguous
        multiplier = 1_000 if unit in ("ribu", "rb", "k") else 1_000_000
        try:
            value = Decimal(num.replace(",", ".")) * multiplier
        except InvalidOperation:
            return None
        if value != value.to_integral_value():
            return None
        result = int(value)
    elif _GROUPED.fullmatch(num):
        result = int(re.sub(r"[.,]", "", num))
    elif num.isdigit():
        result = int(num)
        if not has_rp and result < PLAIN_MONEY_MIN_IDR:
            return None
    else:
        return None  # a decimal with no unit, such as "1,2": not an IDR amount
    if result <= 0 or result > MAX_IDR:
        return None
    return result


def _blank(text: str, start: int, end: int) -> str:
    """Replace a matched span with spaces so later patterns cannot see it. Length is preserved."""
    return text[:start] + " " * (end - start) + text[end:]


def parse_product_query(text: str) -> ProductFilters:
    """Parse an Indonesian product query into ProductFilters.

    Raises QueryParseError on a non-text or over-long input.
    """
    if not isinstance(text, str):
        raise QueryParseError("query must be text")
    if len(text) > MAX_QUERY_CHARS:
        raise QueryParseError("query too long")
    work = " ".join(text.lower().replace("2013", "-").split())

    price_lt: int | None = None
    price_lte: int | None = None
    for match in _OP_AMOUNT_RE.finditer(work):
        if price_lt is not None or price_lte is not None:
            break  # the first price operator wins; later amounts become unparsed_budget
        value = _to_idr(match.group("num"), match.group("unit"), "rp" in match.group(0))
        if value is None:
            continue
        if match.group("lt") is not None:
            price_lt = value
        else:
            price_lte = value
        work = _blank(work, match.start(), match.end())
        break

    size_eu: int | None = None
    size_match = _SIZE_RE.search(work)
    if size_match is not None:
        candidate = int(size_match.group("size"))
        if 30 <= candidate <= 50:
            size_eu = candidate
        work = _blank(work, size_match.start(), size_match.end())

    unparsed_budget: int | None = None
    for match in _AMOUNT_RE.finditer(work):
        value = _to_idr(match.group("num"), match.group("unit"), "rp" in match.group(0))
        if value is None:
            continue
        unparsed_budget = value
        work = _blank(work, match.start(), match.end())
        break

    keywords: list[str] = []
    for pattern, label in PHRASES:
        found = re.search(pattern, work)
        if found is not None:
            keywords.append(label)
            work = _blank(work, found.start(), found.end())

    colors: set[str] = set()
    category: str | None = None
    for token in _TOKEN_RE.findall(work):
        if token in COLOR_WORDS:
            colors.add(COLOR_WORDS[token])
        elif token in CATEGORY_WORDS:
            category = CATEGORY_WORDS[token]
        elif token not in STOPWORDS and token not in keywords:
            keywords.append(token)

    color = next(iter(colors)) if len(colors) == 1 else None
    return ProductFilters(
        category=category,
        price_lt=price_lt,
        price_lte=price_lte,
        size_eu=size_eu,
        color=color,
        keywords=keywords[:MAX_KEYWORDS],
        unparsed_budget=unparsed_budget,
    )
