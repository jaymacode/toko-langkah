"""Error mapping for assistant turns: a recoverable 503 envelope, never a guess or provider text."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from tokolangkah_api.assistant.errors import AssistantUnavailable
from tokolangkah_api.errors import error_response

logger = logging.getLogger(__name__)
ASSISTANT_UNAVAILABLE_MESSAGE = "Asisten sedang tidak tersedia. Coba lagi beberapa saat."


def _assistant_unavailable(request: Request, exc: Exception) -> JSONResponse:
    # Log the fixed reason label only (set by the code that raised it), never provider text.
    reason = exc.reason if isinstance(exc, AssistantUnavailable) else "unknown"
    logger.warning("assistant unavailable reason=%s", reason[:40])
    return error_response(request, 503, "assistant_unavailable", ASSISTANT_UNAVAILABLE_MESSAGE)


def register_turn_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AssistantUnavailable, _assistant_unavailable)
