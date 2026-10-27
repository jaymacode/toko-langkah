"""Pure ASGI middleware that assigns and echoes a per-request correlation ID."""

from __future__ import annotations

import re
import uuid
from typing import Any

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_STATE_KEY = "request_id"
_VALID_INCOMING_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")


def request_id_from_scope(scope: Scope) -> str:
    """Return the request ID stored by RequestIdMiddleware, or 'unknown' if absent."""
    state: Any = scope.get("state")
    if isinstance(state, dict):
        value: Any = state.get(REQUEST_ID_STATE_KEY)
        if isinstance(value, str):
            return value
    return "unknown"


class RequestIdMiddleware:
    """Reuse a safe incoming X-Request-ID, otherwise generate one, and echo it on responses."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming: str | None = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        if incoming is not None and _VALID_INCOMING_ID.fullmatch(incoming):
            request_id = incoming
        else:
            request_id = uuid.uuid4().hex

        scope.setdefault("state", {})[REQUEST_ID_STATE_KEY] = request_id

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID_HEADER] = request_id
            await send(message)

        await self.app(scope, receive, send_with_request_id)
