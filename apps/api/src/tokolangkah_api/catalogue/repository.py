"""Parameterised catalogue reads. Every read runs in a transaction with `SET LOCAL ROLE anon`.

RLS then decides visibility: anon sees public catalogue rows only. Stock counts are read only to
compute the boolean in_stock flag; the counts themselves never leave this module.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg

from tokolangkah_api.catalogue.models import (
    PolicyList,
    PolicySection,
    Product,
    ProductPage,
    PublicPolicy,
)
from tokolangkah_api.db import DB_CONNECT_TIMEOUT_SECONDS, DB_STATEMENT_TIMEOUT_MS
from tokolangkah_api.settings import Settings


class DatabaseUnavailable(Exception):
    """No DATABASE_URL is configured. Mapped to the same 503 as a driver failure."""


_COUNT_PRODUCTS_SQL = "SELECT count(*) FROM products"

_PRODUCT_SELECT_SQL = """
SELECT p.external_id, p.slug, p.name, p.category, p.description, p.color, p.price_idr,
       p.tags, p.image_path, p.image_alt,
       COALESCE(
           (SELECT json_agg(
                       json_build_object('size_eu', v.size_eu, 'in_stock', v.stock > 0)
                       ORDER BY v.size_eu)
              FROM product_variants AS v
             WHERE v.product_id = p.id),
           '[]'::json) AS sizes
  FROM products AS p
"""

# Active policies only (RLS lets anon read active rows; the filter is repeated here on purpose).
_LIST_POLICIES_SQL = """
SELECT pol.external_id, pol.title, pol.version, pol.effective_at,
       COALESCE(
           (SELECT json_agg(
                       json_build_object('id', c.external_id, 'section', c.section, 'text', c.text)
                       ORDER BY c.chunk_index)
              FROM policy_chunks AS c
             WHERE c.policy_id = pol.id),
           '[]'::json) AS sections
  FROM policies AS pol
 WHERE pol.active
 ORDER BY pol.title, pol.external_id
"""

_LIST_PRODUCTS_SQL = _PRODUCT_SELECT_SQL + " ORDER BY p.name, p.external_id LIMIT %s OFFSET %s"
_GET_PRODUCT_SQL = _PRODUCT_SELECT_SQL + " WHERE p.slug = %s ORDER BY p.external_id LIMIT 1"


@contextmanager
def anon_cursor(settings: Settings) -> Iterator[psycopg.Cursor[tuple[Any, ...]]]:
    """Yield a cursor inside one transaction whose role is anon (RLS applies)."""
    url = settings.request_database_url()
    if url is None:
        raise DatabaseUnavailable
    with (
        psycopg.connect(
            url.get_secret_value(),
            connect_timeout=DB_CONNECT_TIMEOUT_SECONDS,
            options=f"-c statement_timeout={DB_STATEMENT_TIMEOUT_MS}",
        ) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute("SET LOCAL ROLE anon")
        yield cursor


def _row_to_product(row: tuple[Any, ...]) -> Product:
    (
        external_id,
        slug,
        name,
        category,
        description,
        color,
        price_idr,
        tags,
        image_path,
        image_alt,
        sizes,
    ) = row
    return Product.model_validate(
        {
            "id": external_id,
            "slug": slug,
            "name": name,
            "category": category,
            "description": description,
            "color": color,
            "price_idr": price_idr,
            "tags": list(tags),
            "image_path": image_path,
            "image_alt": image_alt,
            "sizes": sizes,
        }
    )


def list_products(cursor: psycopg.Cursor[tuple[Any, ...]], limit: int, offset: int) -> ProductPage:
    cursor.execute(_COUNT_PRODUCTS_SQL)
    count_row = cursor.fetchone()
    total = int(count_row[0]) if count_row is not None else 0
    cursor.execute(_LIST_PRODUCTS_SQL, (limit, offset))
    items = [_row_to_product(row) for row in cursor.fetchall()]
    return ProductPage(items=items, total=total)


def get_product(cursor: psycopg.Cursor[tuple[Any, ...]], slug: str) -> Product | None:
    cursor.execute(_GET_PRODUCT_SQL, (slug,))
    row = cursor.fetchone()
    return None if row is None else _row_to_product(row)


def list_policies(cursor: psycopg.Cursor[tuple[Any, ...]]) -> PolicyList:
    cursor.execute(_LIST_POLICIES_SQL)
    items = [
        PublicPolicy(
            id=external_id,
            title=title,
            version=version,
            effective_at=effective_at,
            sections=[PolicySection.model_validate(section) for section in sections],
        )
        for external_id, title, version, effective_at, sections in cursor.fetchall()
    ]
    return PolicyList(items=items)
