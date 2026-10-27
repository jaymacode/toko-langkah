"""Order reads. The cursor must come from db_session.user_transaction, so RLS applies."""

from __future__ import annotations

from datetime import UTC
from typing import Any

from tokolangkah_api.db_session import Cursor
from tokolangkah_api.orders.models import Order, OrderItem

_ORDER_SELECT_SQL = """
SELECT o.id,
       o.order_number,
       o.status,
       o.tracking_code,
       o.eta_text,
       o.updated_at,
       COALESCE(
           (SELECT json_agg(
                       json_build_object(
                           'product_name', p.name,
                           'size_eu', v.size_eu,
                           'quantity', oi.quantity,
                           'unit_price_idr', oi.unit_price_idr)
                       ORDER BY p.name, v.size_eu)
              FROM order_items AS oi
              JOIN product_variants AS v ON v.id = oi.variant_id
              JOIN products AS p ON p.id = v.product_id
             WHERE oi.order_id = o.id),
           '[]'::json) AS items
  FROM orders AS o
"""

_LIST_ORDERS_SQL = _ORDER_SELECT_SQL + " ORDER BY o.created_at DESC, o.id DESC"
_GET_ORDER_SQL = _ORDER_SELECT_SQL + " WHERE o.order_number = %s"


def _row_to_order(row: tuple[Any, ...]) -> Order:
    (_id, order_number, status, tracking_code, eta_text, updated_at, items) = row
    return Order(
        order_number=order_number,
        status=status,
        tracking_code=tracking_code,
        eta_text=eta_text,
        updated_at=updated_at.astimezone(UTC),
        items=[OrderItem.model_validate(item) for item in items],
    )


def list_orders(cursor: Cursor) -> list[Order]:
    cursor.execute(_LIST_ORDERS_SQL)
    return [_row_to_order(row) for row in cursor.fetchall()]


def get_order(cursor: Cursor, order_number: str) -> Order | None:
    """Return the caller's order with this number. Zero or several visible matches both give None.

    Order numbers are unique per store, not globally. A caller who can see two orders with the same
    number gets the same 404 as for a missing order rather than a guess.
    """
    cursor.execute(_GET_ORDER_SQL, (order_number,))
    rows = cursor.fetchall()
    if len(rows) != 1:
        return None
    return _row_to_order(rows[0])
