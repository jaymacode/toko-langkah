"""FastAPI application factory.

Run locally with: uv run uvicorn tokolangkah_api.main:create_app --factory --reload
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from tokolangkah_api.catalogue.router import router as catalogue_router
from tokolangkah_api.conversations.router import router as conversations_router
from tokolangkah_api.conversations.turn_errors import register_turn_error_handlers
from tokolangkah_api.db import check_database
from tokolangkah_api.db_session import register_service_error_handlers
from tokolangkah_api.errors import register_error_handlers
from tokolangkah_api.middleware import (
    BodyLimitMiddleware,
    RequestLogMiddleware,
    SecurityHeadersMiddleware,
)
from tokolangkah_api.orders.router import router as orders_router
from tokolangkah_api.request_id import REQUEST_ID_HEADER, RequestIdMiddleware
from tokolangkah_api.settings import AppEnv, Settings
from tokolangkah_api.staff.router import router as staff_router


class HealthResponse(BaseModel):
    status: str
    app_env: AppEnv
    demo_mode: bool
    # "openai" (any OpenAI-compatible endpoint), or null when unconfigured.
    assistant_provider: str | None


class DbHealthResponse(BaseModel):
    status: str


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings if settings is not None else Settings()
    docs_enabled = resolved.app_env is not AppEnv.PRODUCTION

    app = FastAPI(
        title="TokoLangkah API",
        version="0.1.0",
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.state.settings = resolved

    # Added innermost first; each add_middleware wraps the previous ones, so the order from the
    # outside in is: RequestId, RequestLog, SecurityHeaders, CORS, BodyLimit, then the routes.
    # BodyLimit sits inside CORS so its 413 still carries the CORS headers for the browser.
    app.add_middleware(BodyLimitMiddleware)
    # Exact origins only; a wildcard is never combined with credentials.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER, "Retry-After"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLogMiddleware)
    # Outermost user middleware: every response, including 413 and CORS rejections, has the ID.
    app.add_middleware(RequestIdMiddleware)
    register_error_handlers(app)
    register_service_error_handlers(app)
    register_turn_error_handlers(app)
    app.include_router(catalogue_router)
    app.include_router(orders_router)
    app.include_router(conversations_router)
    app.include_router(staff_router)

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            app_env=resolved.app_env,
            demo_mode=resolved.demo_mode,
            assistant_provider=(
                str(resolved.assistant_provider) if resolved.assistant_provider else None
            ),
        )

    @app.get("/health/db", response_model=DbHealthResponse)
    def health_db() -> JSONResponse:
        if check_database(resolved):
            return JSONResponse({"status": "ok"}, status_code=200)
        return JSONResponse({"status": "unavailable"}, status_code=503)

    return app
