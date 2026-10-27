"""Public catalogue routes: GET /products and GET /products/{slug}."""

from __future__ import annotations

from typing import Annotated

import psycopg
from fastapi import APIRouter, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from tokolangkah_api.catalogue import repository
from tokolangkah_api.catalogue.models import SLUG_PATTERN, Product, ProductPage
from tokolangkah_api.errors import ErrorBody, ErrorEnvelope
from tokolangkah_api.request_id import REQUEST_ID_HEADER, request_id_from_scope
from tokolangkah_api.settings import Settings

MAX_LIMIT = 50
MAX_OFFSET = 1_000_000

router = APIRouter(tags=["catalogue"])


def _service_unavailable(request: Request) -> JSONResponse:
    # Same envelope as the rest of the API. No exception text, no connection details.
    request_id = request_id_from_scope(request.scope)
    envelope = ErrorEnvelope(
        error=ErrorBody(
            code="service_unavailable",
            message="Service unavailable.",
            request_id=request_id,
        )
    )
    return JSONResponse(
        envelope.model_dump(),
        status_code=503,
        headers={REQUEST_ID_HEADER: request_id},
    )


@router.get("/products", response_model=ProductPage)
def list_products(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 20,
    offset: Annotated[int, Query(ge=0, le=MAX_OFFSET)] = 0,
) -> ProductPage | Response:
    settings: Settings = request.app.state.settings
    try:
        with repository.anon_cursor(settings) as cursor:
            return repository.list_products(cursor, limit, offset)
    except (psycopg.Error, repository.DatabaseUnavailable):
        return _service_unavailable(request)


@router.get("/products/{slug}", response_model=Product)
def get_product(
    request: Request,
    slug: Annotated[str, Path(pattern=SLUG_PATTERN)],
) -> Product | Response:
    settings: Settings = request.app.state.settings
    try:
        with repository.anon_cursor(settings) as cursor:
            product = repository.get_product(cursor, slug)
    except (psycopg.Error, repository.DatabaseUnavailable):
        return _service_unavailable(request)
    if product is None:
        raise HTTPException(status_code=404)
    return product
