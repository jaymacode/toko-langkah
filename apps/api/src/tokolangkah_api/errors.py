"""Typed error envelope and exception handlers. Responses never include stack traces."""

from __future__ import annotations

import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from tokolangkah_api.request_id import REQUEST_ID_HEADER, request_id_from_scope

logger = logging.getLogger(__name__)

_HTTP_ERROR_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    429: "rate_limited",
}


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str


class ErrorEnvelope(BaseModel):
    error: ErrorBody


def _error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    extra_headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = request_id_from_scope(request.scope)
    envelope = ErrorEnvelope(error=ErrorBody(code=code, message=message, request_id=request_id))
    headers = dict(extra_headers or {})
    headers[REQUEST_ID_HEADER] = request_id
    return JSONResponse(envelope.model_dump(), status_code=status_code, headers=headers)


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    extra_headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Public helper: the standard error envelope with the request ID header."""
    return _error_response(request, status_code, code, message, extra_headers)


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _HTTP_ERROR_CODES.get(exc.status_code, "http_error")
    try:
        message = HTTPStatus(exc.status_code).phrase
    except ValueError:
        message = "Request failed."
    # Pass through headers set by the raiser (for example Retry-After on 429).
    extra = {k: v for k, v in (exc.headers or {}).items() if k.lower() == "retry-after"}
    return _error_response(request, exc.status_code, code, message, extra)


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return _error_response(request, 422, "validation_error", "Request validation failed.")


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Log only the exception class and request ID: no message, no traceback, no request body.
    logger.error(
        "unhandled error type=%s request_id=%s",
        type(exc).__name__,
        request_id_from_scope(request.scope),
    )
    return _error_response(request, 500, "internal_error", "An internal error occurred.")


async def _dispatch_http_exception(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):
        return await unhandled_exception_handler(request, exc)
    return await http_exception_handler(request, exc)


async def _dispatch_validation_exception(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        return await unhandled_exception_handler(request, exc)
    return await validation_exception_handler(request, exc)


def register_error_handlers(app: FastAPI) -> None:
    # Typed handlers above are wrapped so each accepts the Exception base type Starlette expects.
    app.add_exception_handler(StarletteHTTPException, _dispatch_http_exception)
    app.add_exception_handler(RequestValidationError, _dispatch_validation_exception)
    app.add_exception_handler(Exception, unhandled_exception_handler)
