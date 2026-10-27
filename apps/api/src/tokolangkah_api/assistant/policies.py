"""Policy retrieval over active, effective policy chunks (anon role, RLS applies).

Evidence is returned as plain data. Excerpts are never executed, interpolated into SQL or used
as instructions; callers must treat them as quoted text.
"""

from __future__ import annotations

import re
from typing import Any, Final

import psycopg
from pydantic import BaseModel, ConfigDict

from tokolangkah_api.assistant.products import DEMO_STORE_EXTERNAL_ID
from tokolangkah_api.assistant.store import run_anon_query

MAX_LIMIT: Final = 5
MAX_EXCERPT_CHARS: Final = 600
MAX_TERMS: Final = 20

POLICY_SYNONYMS: Final[dict[str, tuple[str, ...]]] = {
    "retur": ("retur", "pengembalian", "penukaran", "tukar"),
    "pengembalian": ("pengembalian", "retur"),
    "tukar": ("tukar", "penukaran", "retur"),
    "penukaran": ("penukaran", "tukar", "retur"),
    "ongkir": ("ongkir", "pengiriman", "kirim"),
    "kirim": ("kirim", "pengiriman", "ongkir"),
    "pengiriman": ("pengiriman", "kirim", "ongkir"),
    "bayar": ("bayar", "pembayaran"),
    "pembayaran": ("pembayaran", "bayar"),
    "sampai": ("sampai", "tiba", "pengiriman"),
    "tiba": ("tiba", "sampai"),
    "ukuran": ("ukuran", "size"),
    "size": ("size", "ukuran"),
    "cs": ("cs", "bantuan"),
    "manusia": ("manusia", "bantuan"),
}
POLICY_STOPWORDS: Final[frozenset[str]] = frozenset(
    {
        "bisa", "berapa", "apa", "saya", "aku", "di", "ke", "yang", "dan", "atau", "ini", "itu",
        "kah", "pasti", "mau", "untuk", "dengan", "sih", "dong", "ya", "gimana", "bagaimana",
        "apakah", "kapan", "ada", "dari", "the", "is", "a", "an", "tidak", "boleh",
    }
)  # fmt: skip

_TERM_RE: Final = re.compile(r"[a-z0-9]{2,}")

_EVIDENCE_SQL: Final = """
WITH scored AS (
    SELECT c.external_id AS chunk_id, p.title, c.section, p.version, c.text AS excerpt,
           to_tsvector('simple', c.section || ' ' || c.text) AS tsv,
           lower(c.section || ' ' || c.text) AS hay
      FROM policy_chunks AS c
      JOIN policies AS p ON p.id = c.policy_id
     WHERE p.store_id = (SELECT s.id FROM stores AS s WHERE s.external_id = %(store)s)
       AND p.active
       AND p.effective_at <= now()
)
SELECT chunk_id, title, section, version, excerpt,
       ts_rank(tsv, to_tsquery('simple', %(tsquery)s)) AS rank,
       (SELECT count(*) FROM unnest(%(terms)s::text[]) AS t(term)
         WHERE strpos(hay, t.term) > 0) AS keyword_hits
  FROM scored
 WHERE tsv @@ to_tsquery('simple', %(tsquery)s)
    OR EXISTS (SELECT 1 FROM unnest(%(terms)s::text[]) AS t(term)
                WHERE strpos(hay, t.term) > 0)
 ORDER BY keyword_hits DESC, rank DESC, chunk_id ASC
 LIMIT %(limit)s
"""


class Evidence(BaseModel):
    """One policy chunk returned as quoted data. The field set is fixed."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    chunk_id: str
    title: str
    section: str
    version: str
    excerpt: str


def policy_terms(query: str) -> list[str]:
    """Lowercase alphanumeric terms with synonyms expanded. Never contains SQL or punctuation."""
    terms: list[str] = []
    for token in _TERM_RE.findall(query.lower()):
        if token in POLICY_STOPWORDS:
            continue
        for term in POLICY_SYNONYMS.get(token, (token,)):
            if term not in terms:
                terms.append(term)
    return terms[:MAX_TERMS]


def search_policies(conn: psycopg.Connection[Any], query: str, limit: int = 5) -> list[Evidence]:
    """Return up to `limit` active, effective chunks ranked by keyword hits, then full-text rank."""
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError("limit must be between 1 and 5")
    terms = policy_terms(query)
    if not terms:
        return []
    params: dict[str, Any] = {
        "store": DEMO_STORE_EXTERNAL_ID,
        "tsquery": " | ".join(terms),
        "terms": terms,
        "limit": limit,
    }
    rows = run_anon_query(conn, _EVIDENCE_SQL, params)
    return [
        Evidence(
            chunk_id=chunk_id,
            title=title,
            section=section,
            version=version,
            excerpt=excerpt[:MAX_EXCERPT_CHARS],
        )
        for chunk_id, title, section, version, excerpt, _rank, _hits in rows
    ]
