"""Response models for orders. Internal ids and customer ids are deliberately absent."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

ORDER_NUMBER_PATTERN = r"^[A-Z0-9-]{3,32}$"


class OrderItem(BaseModel):
    product_name: str
    size_eu: int
    quantity: int
    unit_price_idr: int


class Order(BaseModel):
    order_number: str
    status: str
    tracking_code: str | None
    eta_text: str | None
    updated_at: datetime
    items: list[OrderItem]


class OrderList(BaseModel):
    items: list[Order]
