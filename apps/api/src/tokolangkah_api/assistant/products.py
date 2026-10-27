"""Product search with exact SQL predicates, run as the anon role (RLS applies).

Predicates (all bound parameters):
- store scope: the single demo store, resolved server-side by its fixed external id;
- category, colour (case-insensitive substring of the stored colour), price strict or inclusive
  exactly as parsed;
- stock: a product needs at least one variant with stock > 0. If a size is given, THAT size must
  have stock > 0. Out-of-stock sizes are never reported in sizes_in_stock.
Ranking: keyword score desc, price asc, slug asc. Keywords are matched as substrings of name,
category, description, colour and tags, expanded with a small Indonesian/English synonym map.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Final

import psycopg
from pydantic import BaseModel, ConfigDict, Field

from tokolangkah_api.assistant.embeddings import vector_literal
from tokolangkah_api.assistant.query_parser import ProductFilters
from tokolangkah_api.assistant.store import run_anon_query

DEMO_STORE_EXTERNAL_ID: Final = "store-demo"
MAX_LIMIT: Final = 10

SYNONYMS: Final[dict[str, tuple[str, ...]]] = {
    "jalan jauh": ("jalan jauh", "berjalan jauh", "walking"),
    "walking": ("walking", "jalan jauh"),
    "trail": ("trail", "jalur tanah", "outdoor"),
    "outdoor": ("outdoor", "trail"),
    "jalur tanah": ("jalur tanah", "trail"),
    "kanvas": ("kanvas", "canvas"),
    "canvas": ("canvas", "kanvas"),
    "rajut": ("rajut", "knit"),
    "knit": ("knit", "rajut"),
    "kasual": ("kasual", "harian"),
    "harian": ("harian", "kasual"),
}


class ProductHit(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    external_id: str
    slug: str
    name: str
    price_idr: int
    color: str | None
    sizes_in_stock: list[int] = Field(default_factory=list)
    image_path: str | None = None
    image_alt: str = ""
    matched_terms: list[str] = Field(default_factory=list)


def keyword_groups(keywords: list[str]) -> list[tuple[str, ...]]:
    """Each keyword becomes one group; a product matches a group if any of its terms appears."""
    groups: list[tuple[str, ...]] = []
    for keyword in keywords:
        terms = SYNONYMS.get(keyword, (keyword,))
        groups.append(tuple(dict.fromkeys(terms)))
    return groups


_PRODUCT_SQL: Final = """
SELECT ranked.external_id, ranked.slug, ranked.name, ranked.price_idr, ranked.color,
       ranked.category, ranked.description, ranked.tags, ranked.sizes_in_stock, ranked.score,
       ranked.image_path, ranked.image_alt
  FROM (
        SELECT p.external_id, p.slug, p.name, p.price_idr, p.color, p.category, p.description,
               p.tags, p.image_path, p.image_alt,
               (SELECT count(DISTINCT g.gid)
                  FROM unnest(%(terms)s::text[], %(term_groups)s::int[]) AS g(term, gid)
                 WHERE strpos(lower(concat_ws(' ', p.name, p.category, p.description, p.color,
                       array_to_string(p.tags, ' '))), g.term) > 0) AS score,
               ARRAY(SELECT v.size_eu FROM product_variants AS v
                      WHERE v.product_id = p.id AND v.stock > 0
                      ORDER BY v.size_eu) AS sizes_in_stock
          FROM products AS p
         WHERE p.store_id = (SELECT s.id FROM stores AS s WHERE s.external_id = %(store)s)
           AND (%(category)s::text IS NULL OR p.category = %(category)s)
           AND (%(price_lt)s::bigint IS NULL OR p.price_idr < %(price_lt)s)
           AND (%(price_lte)s::bigint IS NULL OR p.price_idr <= %(price_lte)s)
           AND (%(color)s::text IS NULL
                OR strpos(lower(coalesce(p.color, '')), %(color)s) > 0)
           AND (%(size)s::int IS NULL OR EXISTS (
                SELECT 1 FROM product_variants AS v
                 WHERE v.product_id = p.id AND v.size_eu = %(size)s AND v.stock > 0))
           AND EXISTS (SELECT 1 FROM product_variants AS v
                        WHERE v.product_id = p.id AND v.stock > 0)
       ) AS ranked
 WHERE (NOT %(has_keywords)s OR ranked.score > 0)
 ORDER BY ranked.score DESC, ranked.price_idr ASC, ranked.slug ASC
 LIMIT %(limit)s
"""

# Hybrid: keyword share of the keyword groups (0..1) plus exact cosine similarity to the query.
# Only rows whose embedding_version equals the query version get a cosine term; others use keyword
# only. The keyword gate is not applied, so semantic matches can surface. The hard predicates below
# are the same as _PRODUCT_SQL and still apply before ranking.
_PRODUCT_HYBRID_SQL: Final = """
SELECT ranked.external_id, ranked.slug, ranked.name, ranked.price_idr, ranked.color,
       ranked.category, ranked.description, ranked.tags, ranked.sizes_in_stock,
       ranked.hybrid_score AS score, ranked.image_path, ranked.image_alt
  FROM (
        SELECT scored.*,
               CASE WHEN scored.cos IS NULL THEN scored.kw
                    ELSE 0.5 * scored.kw + 0.5 * scored.cos END AS hybrid_score
          FROM (
                SELECT p.external_id, p.slug, p.name, p.price_idr, p.color, p.category,
                       p.description, p.tags, p.image_path, p.image_alt,
                       ARRAY(SELECT v.size_eu FROM product_variants AS v
                              WHERE v.product_id = p.id AND v.stock > 0
                              ORDER BY v.size_eu) AS sizes_in_stock,
                       (SELECT count(DISTINCT g.gid)
                          FROM unnest(%(terms)s::text[], %(term_groups)s::int[]) AS g(term, gid)
                         WHERE strpos(lower(concat_ws(' ', p.name, p.category, p.description,
                               p.color, array_to_string(p.tags, ' '))), g.term) > 0)
                              ::double precision
                           / GREATEST(%(n_groups)s::int, 1) AS kw,
                       CASE WHEN p.embedding IS NOT NULL AND p.embedding_version = %(version)s
                            THEN 1 - (p.embedding OPERATOR(extensions.<=>)
                                      %(qvec)s::extensions.vector)
                       END AS cos
                  FROM products AS p
                 WHERE p.store_id = (SELECT s.id FROM stores AS s WHERE s.external_id = %(store)s)
                   AND (%(category)s::text IS NULL OR p.category = %(category)s)
                   AND (%(price_lt)s::bigint IS NULL OR p.price_idr < %(price_lt)s)
                   AND (%(price_lte)s::bigint IS NULL OR p.price_idr <= %(price_lte)s)
                   AND (%(color)s::text IS NULL
                        OR strpos(lower(coalesce(p.color, '')), %(color)s) > 0)
                   AND (%(size)s::int IS NULL OR EXISTS (
                        SELECT 1 FROM product_variants AS v
                         WHERE v.product_id = p.id AND v.size_eu = %(size)s AND v.stock > 0))
                   AND EXISTS (SELECT 1 FROM product_variants AS v
                                WHERE v.product_id = p.id AND v.stock > 0)
               ) AS scored
       ) AS ranked
 WHERE ranked.hybrid_score > 0
 ORDER BY ranked.hybrid_score DESC, ranked.price_idr ASC, ranked.slug ASC
 LIMIT %(limit)s
"""


def build_product_query(filters: ProductFilters, limit: int) -> tuple[str, dict[str, Any]]:
    """Return (static SQL, named parameters). User text only ever appears in the parameters."""
    return _PRODUCT_SQL, _product_params(filters, limit)


def _product_params(filters: ProductFilters, limit: int) -> dict[str, Any]:
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError("limit must be between 1 and 10")
    terms: list[str] = []
    term_groups: list[int] = []
    for group_id, group in enumerate(keyword_groups(filters.keywords), start=1):
        for term in group:
            terms.append(term)
            term_groups.append(group_id)
    return {
        "store": DEMO_STORE_EXTERNAL_ID,
        "category": filters.category,
        "price_lt": filters.price_lt,
        "price_lte": filters.price_lte,
        "color": filters.color,
        "size": filters.size_eu,
        "terms": terms,
        "term_groups": term_groups,
        "has_keywords": bool(terms),
        "limit": limit,
    }


def build_hybrid_product_query(
    filters: ProductFilters, limit: int, vector_text: str, version: str
) -> tuple[str, dict[str, Any]]:
    params = _product_params(filters, limit)
    params.pop("has_keywords")
    params["n_groups"] = len(filters.keywords)
    params["qvec"] = vector_text
    params["version"] = version
    return _PRODUCT_HYBRID_SQL, params


def _matched_terms(groups: list[tuple[str, ...]], keywords: list[str], hay: str) -> list[str]:
    matched: list[str] = []
    for keyword, terms in zip(keywords, groups, strict=True):
        if any(term in hay for term in terms):
            matched.append(keyword)
    return matched


def search_products(
    conn: psycopg.Connection[Any],
    filters: ProductFilters,
    limit: int = 5,
    *,
    query_vector: Sequence[float] | None = None,
    version: str | None = None,
) -> list[ProductHit]:
    """Return in-stock products matching the filters. Raises StoreUnavailable on DB failure.

    With query_vector and version (hybrid), ranking adds cosine similarity for rows embedded under
    the same version. Without them, the keyword baseline runs unchanged.
    """
    if (query_vector is None) != (version is None):
        raise ValueError("query_vector and version are passed together")
    if query_vector is None or version is None:
        sql, params = build_product_query(filters, limit)
    else:
        sql, params = build_hybrid_product_query(
            filters, limit, vector_literal(query_vector), version
        )
    rows = run_anon_query(conn, sql, params)
    groups = keyword_groups(filters.keywords)
    hits: list[ProductHit] = []
    for row in rows:
        (
            external_id,
            slug,
            name,
            price_idr,
            color,
            category,
            description,
            tags,
            sizes,
            _score,
            image_path,
            image_alt,
        ) = row
        hay = " ".join([name, category, description, color or "", " ".join(tags)]).lower()
        hits.append(
            ProductHit(
                external_id=external_id,
                slug=slug,
                name=name,
                price_idr=int(price_idr),
                color=color,
                sizes_in_stock=[int(size) for size in sizes],
                image_path=image_path,
                image_alt=image_alt or "",
                matched_terms=_matched_terms(groups, filters.keywords, hay),
            )
        )
    return hits
