"""Embed the active policy chunks and all products (admin path, DATABASE_URL = table owner).

Run:  uv run python -m tokolangkah_api.admin.embed

A row is embedded when its embedding is NULL, its embedding_version differs from the configured
"<OPENAI_EMBEDDING_MODEL>:1536", or the sha256 of its current text differs from the stored hash.
Every row that needs a vector goes into ONE embeddings request. A second run with unchanged text
makes no request. Only counts are printed, never text, vectors or keys.

Requires OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL, LIVE_EVAL_BUDGET_USD > 0 and DATABASE_URL.
Exit codes: 0 done (including nothing to embed), 1 failed, 2 BLOCKED (nothing was sent).
Reads only os.environ, never a .env file.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Final
from uuid import UUID

import psycopg
from pydantic import SecretStr

from tokolangkah_api.assistant.embeddings import (
    Embedder,
    policy_embedding_text,
    product_embedding_text,
    text_sha256,
    vector_literal,
)
from tokolangkah_api.assistant.errors import AssistantError
from tokolangkah_api.assistant.providers import build_embedding_client
from tokolangkah_api.settings import AppEnv, Settings

EXIT_DONE: Final = 0
EXIT_FAILED: Final = 1
EXIT_BLOCKED: Final = 2
CONNECT_TIMEOUT_SECONDS: Final = 5

_POLICY_ROWS_SQL: Final = """
SELECT c.id, c.embedding_version, c.embedding_text_sha256, c.embedding IS NOT NULL,
       p.title, c.section, c.text
  FROM policy_chunks AS c
  JOIN policies AS p ON p.id = c.policy_id
 WHERE p.active AND p.effective_at <= now()
 ORDER BY c.id
"""
_PRODUCT_ROWS_SQL: Final = """
SELECT p.id, p.embedding_version, p.embedding_text_sha256, p.embedding IS NOT NULL,
       p.name, p.category, p.color, p.description, p.tags
  FROM products AS p
 ORDER BY p.id
"""
_UPDATE_POLICY_SQL: Final = """
UPDATE policy_chunks
   SET embedding = %s::extensions.vector, embedding_version = %s, embedding_text_sha256 = %s
 WHERE id = %s
"""
_UPDATE_PRODUCT_SQL: Final = """
UPDATE products
   SET embedding = %s::extensions.vector, embedding_version = %s, embedding_text_sha256 = %s
 WHERE id = %s
"""


@dataclass(frozen=True)
class Item:
    kind: str  # "policy" | "product"
    row_id: UUID
    text: str
    sha256: str
    stored_version: str | None
    stored_sha256: str | None
    has_embedding: bool

    def needs_embedding(self, version: str) -> bool:
        return (
            not self.has_embedding
            or self.stored_version != version
            or self.stored_sha256 != self.sha256
        )


def blocked_reason(env: Mapping[str, str]) -> str | None:
    """Why ingestion cannot run, or None. Names a variable, never prints its value."""
    if not env.get("OPENAI_API_KEY", "").strip():
        return "BLOCKED: OPENAI_API_KEY is not set (no embedding call was made)"
    if not env.get("OPENAI_EMBEDDING_MODEL", "").strip():
        return "BLOCKED: OPENAI_EMBEDDING_MODEL is not set (no embedding call was made)"
    raw_budget = env.get("LIVE_EVAL_BUDGET_USD", "").strip() or "0"
    try:
        budget = Decimal(raw_budget)
    except InvalidOperation:
        return "BLOCKED: LIVE_EVAL_BUDGET_USD is not a number"
    if not budget.is_finite() or budget <= 0:
        return "BLOCKED: LIVE_EVAL_BUDGET_USD must be > 0 (no embedding call was made)"
    if not env.get("DATABASE_URL", "").strip():
        return "BLOCKED: DATABASE_URL is not set (the ingest writes to the database)"
    return None


def collect_items(conn: psycopg.Connection[Any]) -> list[Item]:
    """Every active policy chunk and every product, with the text that would be embedded."""
    items: list[Item] = []
    for row in conn.execute(_POLICY_ROWS_SQL).fetchall():
        row_id, version, sha, has_vector, title, section, text = row
        body = policy_embedding_text(title, section, text)
        items.append(
            Item("policy", row_id, body, text_sha256(body), version, sha, bool(has_vector))
        )
    for row in conn.execute(_PRODUCT_ROWS_SQL).fetchall():
        row_id, version, sha, has_vector, name, category, color, description, tags = row
        body = product_embedding_text(name, category, color, description, list(tags))
        items.append(
            Item("product", row_id, body, text_sha256(body), version, sha, bool(has_vector))
        )
    return items


def write_vectors(
    conn: psycopg.Connection[Any], items: list[Item], vectors: list[list[float]], version: str
) -> None:
    """Store vectors, version and text hash in one transaction (the caller commits)."""
    for item, vector in zip(items, vectors, strict=True):
        sql = _UPDATE_POLICY_SQL if item.kind == "policy" else _UPDATE_PRODUCT_SQL
        conn.execute(sql, (vector_literal(vector), version, item.sha256, item.row_id))


def ingest_on(conn: psycopg.Connection[Any], embedder: Embedder) -> dict[str, Any]:
    """Embed what is missing or stale, on the caller's connection (caller commits or rolls back)."""
    items = collect_items(conn)
    todo = [item for item in items if item.needs_embedding(embedder.version)]
    if todo:
        vectors = embedder.embed([item.text for item in todo])  # exactly one request
        write_vectors(conn, todo, vectors, embedder.version)
    return {
        "version": embedder.version,
        "rows_total": len(items),
        "rows_embedded": len(todo),
        "rows_unchanged": len(items) - len(todo),
    }


def run_ingest(database_url: str, embedder: Embedder) -> dict[str, Any]:
    """Connect as the table owner, ingest, commit. Counts only."""
    with psycopg.connect(database_url, connect_timeout=CONNECT_TIMEOUT_SECONDS) as conn:
        counts = ingest_on(conn, embedder)
        conn.commit()
    return counts


def settings_from_env(env: Mapping[str, str]) -> Settings:
    """Settings for embedding calls from explicit variables only (run blocked_reason first)."""
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        app_env=AppEnv.TEST,
        database_url=SecretStr(env["DATABASE_URL"].strip()),
        openai_api_key=SecretStr(env["OPENAI_API_KEY"].strip()),
        openai_embedding_model=env["OPENAI_EMBEDDING_MODEL"].strip(),
        live_eval_budget_usd=float(env["LIVE_EVAL_BUDGET_USD"].strip()),
        openai_embedding_price_per_mtok=Decimal(
            env.get("OPENAI_EMBEDDING_PRICE_PER_MTOK", "").strip() or "0.02"
        ),
    )


def main(argv: list[str] | None = None) -> int:
    del argv  # no options; the scope is always the whole active corpus
    env = os.environ
    reason = blocked_reason(env)
    if reason is not None:
        print(reason)
        return EXIT_BLOCKED
    database_url = env["DATABASE_URL"].strip()
    try:
        embedder = build_embedding_client(settings_from_env(env), source="ingest")
        counts = run_ingest(database_url, embedder)
    except (AssistantError, psycopg.Error, ValueError) as exc:
        # Class name only: driver and provider messages can contain connection or key details.
        print(f"FAILED: ingest stopped ({type(exc).__name__}); database state is unchanged")
        return EXIT_FAILED
    usage = embedder.usages[-1] if embedder.usages else None
    print(
        f"ingest: version={counts['version']} rows_total={counts['rows_total']} "
        f"rows_embedded={counts['rows_embedded']} rows_unchanged={counts['rows_unchanged']} "
        f"requests={embedder.requests}"
    )
    if usage is not None:
        print(
            f"ingest: input_tokens={usage.input_tokens} est_cost_usd={usage.cost_usd} "
            f"usage_reported={usage.usage_reported}"
        )
    return EXIT_DONE


if __name__ == "__main__":
    sys.exit(main())
