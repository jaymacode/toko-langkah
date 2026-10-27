"""Policy retrieval over active, effective policy chunks (anon role, RLS applies).

Evidence is returned as plain data. Excerpts are never executed, interpolated into SQL or used
as instructions; callers must treat them as quoted text.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any, Final

import psycopg
from pydantic import BaseModel, ConfigDict

from tokolangkah_api.assistant.embeddings import vector_literal
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


# Hybrid: keyword share of the query terms (0..1) and exact cosine similarity to the query vector.
# No keyword gate, so semantic matches can surface. Active, effective, store-scoped filters
# still apply in the same WHERE clause before ranking. Rows without a same-version embedding
# use keyword only.
_HYBRID_EVIDENCE_SQL = """
WITH scored AS (
    SELECT c.external_id AS chunk_id, p.title, c.section, p.version, c.text AS excerpt,
           (SELECT count(*) FROM unnest(%(terms)s::text[]) AS t(term)
             WHERE strpos(lower(c.section || ' ' || c.text), t.term) > 0) AS keyword_hits,
           CASE WHEN c.embedding IS NOT NULL AND c.embedding_version = %(version)s
                THEN 1 - (c.embedding OPERATOR(extensions.<=>) %(qvec)s::extensions.vector)
           END AS cos
      FROM policy_chunks AS c
      JOIN policies AS p ON p.id = c.policy_id
     WHERE p.store_id = (SELECT s.id FROM stores AS s WHERE s.external_id = %(store)s)
       AND p.active
       AND p.effective_at <= now()
), ranked AS (
    SELECT chunk_id, title, section, version, excerpt, keyword_hits, cos,
           CASE WHEN cos IS NULL
                THEN keyword_hits::double precision / GREATEST(%(n_terms)s::int, 1)
                ELSE 0.5 * keyword_hits::double precision / GREATEST(%(n_terms)s::int, 1)
                     + 0.5 * cos
           END AS hybrid_score
      FROM scored
)
SELECT chunk_id, title, section, version, excerpt, hybrid_score
  FROM ranked
 WHERE hybrid_score > 0
 ORDER BY hybrid_score DESC, keyword_hits DESC, chunk_id ASC
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


def search_policies(
    conn: psycopg.Connection[Any],
    query: str,
    limit: int = 5,
    *,
    query_vector: Sequence[float] | None = None,
    version: str | None = None,
) -> list[Evidence]:
    """Return up to `limit` active, effective chunks.

    Keyword (default): chunks matching a term, ranked by keyword hits, then full-text rank.
    Hybrid (query_vector and version given): no keyword gate; ranked by the hybrid score.
    """
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError("limit must be between 1 and 5")
    if (query_vector is None) != (version is None):
        raise ValueError("query_vector and version are passed together")
    terms = policy_terms(query)
    if query_vector is not None and version is not None:
        hybrid_params: dict[str, Any] = {
            "store": DEMO_STORE_EXTERNAL_ID,
            "terms": terms,
            "n_terms": len(terms),
            "qvec": vector_literal(query_vector),
            "version": version,
            "limit": limit,
        }
        rows = run_anon_query(conn, _HYBRID_EVIDENCE_SQL, hybrid_params)
        return _evidence(rows)
    if not terms:
        return []
    params: dict[str, Any] = {
        "store": DEMO_STORE_EXTERNAL_ID,
        "tsquery": " | ".join(terms),
        "terms": terms,
        "limit": limit,
    }
    rows = run_anon_query(conn, _EVIDENCE_SQL, params)
    return _evidence(rows)


def _evidence(rows: list[tuple[Any, ...]]) -> list[Evidence]:
    """The first five columns are the same in both queries; later columns are ranking details."""
    return [
        Evidence(
            chunk_id=chunk_id,
            title=title,
            section=section,
            version=version,
            excerpt=excerpt[:MAX_EXCERPT_CHARS],
        )
        for chunk_id, title, section, version, excerpt, *_ in rows
    ]
