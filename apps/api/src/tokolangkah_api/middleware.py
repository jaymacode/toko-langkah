"""Pure ASGI middleware: body cap, security headers, and one structured log line per request.

- BodyLimitMiddleware rejects bodies over MAX_BODY_BYTES with a 413 envelope before any route or
  parser sees them. It checks Content-Length first and also counts bytes while reading, so a
  chunked body without a length is capped too. Accepted bodies are replayed to the app unchanged.
- SecurityHeadersMiddleware sets nosniff, no-referrer and no-store on every API response.
- RequestLogMiddleware writes one line per request: request id, method, route template, status,
  latency and the hashed user id when a token was verified. It never logs the raw path or query
  string, headers, bodies, tokens or message content.
"""

from __future__ import annotations

import logging
import time
from typing import Final

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from tokolangkah_api.errors import ErrorBody, ErrorEnvelope
from tokolangkah_api.request_id import request_id_from_scope

MAX_BODY_BYTES: Final = 64 * 1024
USER_HASH_STATE_KEY: Final = "user_hash"
UNMATCHED_ROUTE: Final = "unmatched"

logger = logging.getLogger("tokolangkah_api.request")


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                declared_size = int(declared)
            except ValueError:
                declared_size = -1
            if declared_size < 0:
                await _bad_length(scope, send)
                return
            if declared_size > self.max_bytes:
                await _payload_too_large(scope, send)
                return

        chunks: list[bytes] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > self.max_bytes:
                await _payload_too_large(scope, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        replayed = False

        async def replay_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay_receive, send)


async def _payload_too_large(scope: Scope, send: Send) -> None:
    await _envelope_response(scope, send, 413, "payload_too_large", "Request body is too large.")


async def _bad_length(scope: Scope, send: Send) -> None:
    await _envelope_response(scope, send, 400, "bad_request", "Invalid Content-Length header.")


async def _envelope_response(
    scope: Scope, send: Send, status: int, code: str, message: str
) -> None:
    request_id = request_id_from_scope(scope)
    envelope = ErrorEnvelope(error=ErrorBody(code=code, message=message, request_id=request_id))
    response = JSONResponse(
        envelope.model_dump(),
        status_code=status,
        headers={"X-Request-ID": request_id},
    )

    async def no_body_receive() -> Message:  # the body is not read after a rejection
        return {"type": "http.disconnect"}

    await response(scope, no_body_receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if "X-Content-Type-Options" not in headers:
                    headers["X-Content-Type-Options"] = "nosniff"
                if "Referrer-Policy" not in headers:
                    headers["Referrer-Policy"] = "no-referrer"
                if "Cache-Control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestLogMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status = 500  # stays 500 when the app raises before a response starts

        async def send_capture(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_capture)
        finally:
            latency_ms = int((time.perf_counter() - started) * 1000)
            route = scope.get("route")
            template = getattr(route, "path", None) or UNMATCHED_ROUTE
            state = scope.get("state")
            user_hash = state.get(USER_HASH_STATE_KEY) if isinstance(state, dict) else None
            logger.info(
                "request request_id=%s method=%s route=%s status=%d latency_ms=%d user_hash=%s",
                request_id_from_scope(scope),
                scope.get("method", "-"),
                template,
                status,
                latency_ms,
                user_hash or "-",
            )
