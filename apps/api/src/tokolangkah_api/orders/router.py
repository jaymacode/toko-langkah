"""Routes: GET /orders (own orders, newest first) and GET /orders/{order_number}."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request

from tokolangkah_api import db_session
from tokolangkah_api.auth import AuthenticatedUser, current_user
from tokolangkah_api.orders import repository
from tokolangkah_api.orders.models import ORDER_NUMBER_PATTERN, Order, OrderList
from tokolangkah_api.settings import Settings

_ORDER_NUMBER_RE = re.compile(ORDER_NUMBER_PATTERN)

router = APIRouter(tags=["orders"])


@router.get("/orders", response_model=OrderList)
def list_orders(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
) -> OrderList:
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        return OrderList(items=repository.list_orders(cursor))


@router.get("/orders/{order_number}", response_model=Order)
def get_order(
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(current_user)],
    order_number: Annotated[str, Path(max_length=64)],
) -> Order:
    # A malformed number is indistinguishable from a missing one, so it gets the same 404.
    if not _ORDER_NUMBER_RE.fullmatch(order_number):
        raise HTTPException(status_code=404)
    settings: Settings = request.app.state.settings
    with (
        db_session.connect(settings) as conn,
        db_session.user_transaction(conn, user.user_id) as cursor,
    ):
        order = repository.get_order(cursor, order_number)
    if order is None:
        raise HTTPException(status_code=404)
    return order
