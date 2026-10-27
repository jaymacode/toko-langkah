"""Typed application settings loaded from environment variables (see repository .env.example)."""

from __future__ import annotations

from decimal import Decimal
from enum import StrEnum
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

MAX_TOOL_CALLS_CEILING = 6


class AppEnv(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    DEMO = "demo"
    PRODUCTION = "production"


class AssistantProvider(StrEnum):
    """`rules` is a deterministic demo planner (not AI). `openai` is the real model provider."""

    RULES = "rules"
    OPENAI = "openai"


class RetrievalMode(StrEnum):
    """`keyword` is the baseline. `hybrid` adds exact cosine similarity over stored embeddings."""

    KEYWORD = "keyword"
    HYBRID = "hybrid"


class Settings(BaseSettings):
    """Runtime configuration. Secret fields are SecretStr so repr and logs never show values."""

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        hide_input_in_errors=True,
    )

    app_env: AppEnv = AppEnv.DEVELOPMENT
    demo_mode: bool = False
    # Admin paths only (migrate, seed, evals): the table owner. Never used by request handlers.
    database_url: SecretStr | None = None
    # The request path's login: a role that owns no tables (migration 0007). Required in production.
    api_database_url: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    openai_model: str | None = None
    # Explicit provider. Unset means `rules` outside production and no assistant in production.
    assistant_provider: AssistantProvider | None = None
    assistant_rate_limit_turns: int = Field(default=20, ge=1, le=10_000)
    assistant_rate_limit_window_seconds: int = Field(default=300, ge=1, le=86_400)
    # Admin-only (seed --target supabase). The service role key bypasses RLS; requests never use it.
    supabase_url: str | None = None
    supabase_service_role_key: SecretStr | None = None
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )
    max_tool_calls: int = Field(default=MAX_TOOL_CALLS_CEILING, ge=1, le=MAX_TOOL_CALLS_CEILING)
    live_eval_budget_usd: float = Field(default=0.0, ge=0.0, allow_inf_nan=False)
    # Conservative USD prices per 1M tokens, used to estimate spend. Override when prices change.
    openai_price_input_per_mtok: Decimal = Field(default=Decimal("0.20"), ge=0, le=1000)
    openai_price_output_per_mtok: Decimal = Field(default=Decimal("1.20"), ge=0, le=1000)
    # Hard cap on completion tokens per model call; also used in the worst-case budget check.
    openai_max_output_tokens: int = Field(default=600, ge=64, le=4000)
    # Embedding model for hybrid retrieval. Vectors are always 1536-dimensional (see embeddings.py).
    openai_embedding_model: str | None = None
    retrieval_mode: RetrievalMode = RetrievalMode.KEYWORD
    # Conservative USD per 1M input tokens for the embedding model. The default is above the
    # text-embedding-3-small list price, so the budget guard never under-counts.
    openai_embedding_price_per_mtok: Decimal = Field(default=Decimal("0.02"), ge=0, le=1000)

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_comma_list(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("allowed_origins")
    @classmethod
    def _validate_exact_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            if "*" in origin:
                raise ValueError("wildcard CORS origins are not allowed; list exact origins")
            parts = urlsplit(origin)
            is_exact = (
                parts.scheme in ("http", "https")
                and bool(parts.hostname)
                and parts.path == ""
                and not parts.query
                and not parts.fragment
                and not parts.username
                and not parts.password
            )
            if not is_exact:
                raise ValueError(
                    "each allowed origin must be an exact scheme://host[:port] value "
                    "without path, query or credentials"
                )
        return origins

    @field_validator("openai_model", mode="after")
    @classmethod
    def _blank_model_is_unset(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return value.strip()

    @field_validator(
        "database_url",
        "api_database_url",
        "openai_api_key",
        "supabase_service_role_key",
        mode="after",
    )
    @classmethod
    def _blank_secret_is_unset(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().strip():
            return None
        return value

    @field_validator("openai_embedding_model", mode="after")
    @classmethod
    def _blank_embedding_model_is_unset(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return value.strip()

    @field_validator("supabase_url", mode="after")
    @classmethod
    def _blank_url_is_unset(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            return None
        return value.strip().rstrip("/") if value is not None else None

    @model_validator(mode="after")
    def _forbid_demo_mode_in_production(self) -> Settings:
        if self.demo_mode and self.app_env is AppEnv.PRODUCTION:
            raise ValueError("DEMO_MODE=true is not allowed when APP_ENV=production")
        return self

    @model_validator(mode="after")
    def _require_api_database_role_in_production(self) -> Settings:
        if self.app_env is not AppEnv.PRODUCTION:
            return self
        if self.api_database_url is None:
            raise ValueError(
                "API_DATABASE_URL is required when APP_ENV=production "
                "(the API must connect as its own role, not the table owner)"
            )
        if (
            self.database_url is not None
            and self.database_url.get_secret_value() == self.api_database_url.get_secret_value()
        ):
            raise ValueError("API_DATABASE_URL must not be the same connection as DATABASE_URL")
        return self

    def request_database_url(self) -> SecretStr | None:
        """The connection used by request handlers: API_DATABASE_URL when set, else DATABASE_URL."""
        return self.api_database_url if self.api_database_url is not None else self.database_url

    @model_validator(mode="after")
    def _validate_retrieval_mode(self) -> Settings:
        if self.retrieval_mode is RetrievalMode.HYBRID:
            if self.openai_api_key is None:
                raise ValueError("RETRIEVAL_MODE=hybrid requires OPENAI_API_KEY")
            if self.openai_embedding_model is None:
                raise ValueError("RETRIEVAL_MODE=hybrid requires OPENAI_EMBEDDING_MODEL")
        return self

    @model_validator(mode="after")
    def _validate_assistant_provider(self) -> Settings:
        provider = self.assistant_provider
        if provider is None:
            # Non-production defaults to the explicit rules demo; production has no assistant
            # unless an operator configures openai (turns then answer 503).
            if self.app_env is not AppEnv.PRODUCTION:
                self.assistant_provider = AssistantProvider.RULES
            return self
        if provider is AssistantProvider.RULES and self.app_env is AppEnv.PRODUCTION:
            raise ValueError("ASSISTANT_PROVIDER=rules is not allowed when APP_ENV=production")
        if provider is AssistantProvider.OPENAI:
            if self.openai_api_key is None:
                raise ValueError("ASSISTANT_PROVIDER=openai requires OPENAI_API_KEY")
            if self.openai_model is None:
                raise ValueError("ASSISTANT_PROVIDER=openai requires OPENAI_MODEL (no default)")
        return self
