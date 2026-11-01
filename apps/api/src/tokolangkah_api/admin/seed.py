"""Idempotent seed of the synthetic demo store. Admin path only: there is no HTTP seed endpoint.

Run from apps/api:
    uv run python -m tokolangkah_api.admin.seed --target local
    uv run python -m tokolangkah_api.admin.seed --target supabase

Targets
    local     Inserts deterministic synthetic rows into the local shim auth.users table.
    supabase  Looks up or creates synthetic users through the Supabase Admin API. Random passwords
              are written only to artifacts/demo-credentials.json (gitignored), never printed.

Data writes always use DATABASE_URL as the table owner. Every upsert is keyed by a stable fixture
key (external_id, sku, or store_id + order_number), so repeated runs leave row counts unchanged.

Exit codes: 0 = seeded, 1 = failed, 2 = refused or BLOCKED (guard or missing prerequisite).
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import psycopg

from tokolangkah_api.admin.fixtures import (
    DATA_DIR,
    DEMO_STORE_ID,
    REPO_ROOT,
    FixtureBundle,
    FixtureError,
    load_fixtures,
)
from tokolangkah_api.admin.supabase_admin import SupabaseAdmin, SupabaseAdminError
from tokolangkah_api.settings import AppEnv, Settings

Target = Literal["local", "supabase"]

ARTIFACTS_DIR = REPO_ROOT / "artifacts"
CREDENTIALS_PATH = ARTIFACTS_DIR / "demo-credentials.json"
SEED_DB_CONNECT_TIMEOUT_SECONDS = 5
SEED_DB_STATEMENT_TIMEOUT_MS = 60_000

# Fixed namespace so local auth-user UUIDs are deterministic across machines and runs.
SYNTHETIC_USER_NAMESPACE = uuid.UUID("3c6e0b8a-5d2f-4a71-9e4b-7f1a2c3d4e5f")
STAFF_ALIAS = "staff-a"
STAFF_EMAIL = "staff-a@example.test"
STORE_SLUG = "demo"
STORE_NAME = "TokoLangkah"
EXIT_SEEDED = 0
EXIT_FAILED = 1
EXIT_REFUSED = 2


class SeedStop(Exception):
    """A guard refused the run or a prerequisite is missing. Maps to exit code 2."""


class SeedFailure(Exception):
    """The run failed after guards passed. Messages contain no secret values."""


@dataclass(frozen=True)
class SyntheticUser:
    alias: str
    email: str
    role: Literal["customer", "staff"]


@dataclass(frozen=True)
class SeededUser:
    alias: str
    email: str
    auth_user_id: str
    role: Literal["customer", "staff"]


@dataclass(frozen=True)
class SeedSummary:
    target: Target
    stores: int
    users: int
    products: int
    variants: int
    orders: int
    order_items: int
    policies: int
    policy_chunks: int


def local_auth_user_id(alias: str) -> uuid.UUID:
    """Deterministic synthetic auth-user UUID for a customer or staff alias (local target only)."""
    return uuid.uuid5(SYNTHETIC_USER_NAMESPACE, f"auth-user:{alias}")


def synthetic_users(bundle: FixtureBundle) -> list[SyntheticUser]:
    users = [
        SyntheticUser(alias=customer.alias, email=customer.email, role="customer")
        for customer in bundle.customers
    ]
    users.append(SyntheticUser(alias=STAFF_ALIAS, email=STAFF_EMAIL, role="staff"))
    return users


def _database_url(settings: Settings) -> str:
    if settings.database_url is None:
        raise SeedStop("BLOCKED: DATABASE_URL is not set")
    return settings.database_url.get_secret_value()


def check_guards(target: Target, settings: Settings) -> None:
    """Refuse unsafe combinations before any network or database write."""
    if target == "local":
        host = (urlsplit(_database_url(settings)).hostname or "").lower()
        if "supabase" in host:
            raise SeedStop("refusing --target local: DATABASE_URL host looks like a Supabase host")
        return
    if settings.app_env is AppEnv.PRODUCTION:
        raise SeedStop("refusing --target supabase when APP_ENV=production")
    _database_url(settings)
    if not settings.supabase_url or settings.supabase_service_role_key is None:
        raise SeedStop(
            "BLOCKED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --target supabase"
        )


def _resolve_supabase_users(
    users: Iterable[SyntheticUser],
    base_url: str,
    service_role_key: str,
) -> tuple[list[SeededUser], dict[str, str]]:
    """Look up each user by email, create it if absent, and rotate its password.

    Rotation keeps the credentials file in step with the password Supabase actually holds.
    Returns the users and their generated passwords (alias -> password). Passwords are held
    only in memory until written to the gitignored credentials file.
    """
    seeded: list[SeededUser] = []
    passwords: dict[str, str] = {}
    with SupabaseAdmin(base_url, service_role_key) as admin:
        for user in users:
            password = secrets.token_urlsafe(24)
            user_id = admin.find_user_id_by_email(user.email)
            if user_id is None:
                user_id = admin.create_user(user.email, password)
            else:
                admin.set_password(user_id, password)
            seeded.append(
                SeededUser(alias=user.alias, email=user.email, auth_user_id=user_id, role=user.role)
            )
            passwords[user.alias] = password
    return seeded, passwords


def write_credentials_file(
    seeded: Sequence[SeededUser],
    passwords: dict[str, str],
    path: Path = CREDENTIALS_PATH,
) -> None:
    """Write synthetic demo credentials with owner-only permissions where the OS supports them."""
    accounts: list[dict[str, str]] = []
    for user in seeded:
        password = passwords.get(user.alias)
        if password is None:
            raise SeedFailure("internal error: missing generated password for a seeded user")
        accounts.append(
            {
                "alias": user.alias,
                "email": user.email,
                "auth_user_id": user.auth_user_id,
                "password": password,
            }
        )
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "warning": "Synthetic demo accounts only. Never commit or share this file.",
        "accounts": accounts,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


# ---------------------------------------------------------------- database writes

_UPSERT_STORE = """
INSERT INTO stores (external_id, slug, name) VALUES (%s, %s, %s)
ON CONFLICT (external_id) DO UPDATE SET slug = excluded.slug, name = excluded.name
RETURNING id
"""

_UPSERT_AUTH_USER_LOCAL = """
INSERT INTO auth.users (id, email) VALUES (%s, %s)
ON CONFLICT (id) DO UPDATE SET email = excluded.email
"""

_UPSERT_STORE_MEMBER = """
INSERT INTO store_members (store_id, user_id, role) VALUES (%s, %s, %s)
ON CONFLICT (store_id, user_id) DO UPDATE SET role = excluded.role
"""

_UPSERT_CUSTOMER = """
INSERT INTO customers (store_id, user_id, alias) VALUES (%s, %s, %s)
ON CONFLICT (store_id, user_id) DO UPDATE SET alias = excluded.alias
"""

_UPSERT_PRODUCT = """
INSERT INTO products (external_id, store_id, slug, name, category, description, color,
                      price_idr, tags, image_path, image_alt)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (external_id) DO UPDATE SET
    store_id = excluded.store_id, slug = excluded.slug, name = excluded.name,
    category = excluded.category, description = excluded.description, color = excluded.color,
    price_idr = excluded.price_idr, tags = excluded.tags, image_path = excluded.image_path,
    image_alt = excluded.image_alt, updated_at = now()
RETURNING id
"""

_UPSERT_VARIANT = """
INSERT INTO product_variants (sku, product_id, size_eu, stock) VALUES (%s, %s, %s, %s)
ON CONFLICT (sku) DO UPDATE SET
    product_id = excluded.product_id, size_eu = excluded.size_eu, stock = excluded.stock
RETURNING id
"""

_UPSERT_POLICY = """
INSERT INTO policies (external_id, store_id, title, version, effective_at, active)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (external_id) DO UPDATE SET
    store_id = excluded.store_id, title = excluded.title, version = excluded.version,
    effective_at = excluded.effective_at, active = excluded.active
RETURNING id
"""

# Changing a chunk's text invalidates any stored embedding; the CHECK constraint keeps the pair
# consistent (both NULL or both set).
_UPSERT_POLICY_CHUNK = """
INSERT INTO policy_chunks (external_id, policy_id, chunk_index, section, text)
VALUES (%s, %s, %s, %s, %s)
ON CONFLICT (external_id) DO UPDATE SET
    policy_id = excluded.policy_id, chunk_index = excluded.chunk_index,
    section = excluded.section,
    embedding = CASE WHEN policy_chunks.text IS DISTINCT FROM excluded.text
                     THEN NULL ELSE policy_chunks.embedding END,
    embedding_version = CASE WHEN policy_chunks.text IS DISTINCT FROM excluded.text
                             THEN NULL ELSE policy_chunks.embedding_version END,
    text = excluded.text
"""

_UPSERT_ORDER = """
INSERT INTO orders (store_id, order_number, customer_id, status, tracking_code, eta_text,
                    updated_at)
VALUES (%s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (store_id, order_number) DO UPDATE SET
    customer_id = excluded.customer_id, status = excluded.status,
    tracking_code = excluded.tracking_code, eta_text = excluded.eta_text,
    updated_at = excluded.updated_at
RETURNING id
"""

_UPSERT_ORDER_ITEM = """
INSERT INTO order_items (order_id, variant_id, quantity, unit_price_idr) VALUES (%s, %s, %s, %s)
ON CONFLICT (order_id, variant_id) DO UPDATE SET
    quantity = excluded.quantity, unit_price_idr = excluded.unit_price_idr
"""


def _returning_id(cur: psycopg.Cursor[Any], sql: str, params: Sequence[object]) -> Any:
    cur.execute(sql, params)
    row = cur.fetchone()
    if row is None:
        raise SeedFailure("upsert returned no row")
    return row[0]


def _seed_database(
    database_url: str,
    bundle: FixtureBundle,
    users: Sequence[SeededUser],
    local_mode: bool,
) -> SeedSummary:
    user_by_alias = {user.alias: uuid.UUID(user.auth_user_id) for user in users}

    with (
        psycopg.connect(
            database_url,
            connect_timeout=SEED_DB_CONNECT_TIMEOUT_SECONDS,
            options=f"-c statement_timeout={SEED_DB_STATEMENT_TIMEOUT_MS}",
        ) as conn,
        conn.cursor() as cur,
    ):
        # One transaction: a failure part-way leaves the database unchanged.
        store_id = _returning_id(cur, _UPSERT_STORE, [DEMO_STORE_ID, STORE_SLUG, STORE_NAME])

        for user in users:
            if local_mode:
                cur.execute(_UPSERT_AUTH_USER_LOCAL, [user_by_alias[user.alias], user.email])
            if user.role == "staff":
                cur.execute(_UPSERT_STORE_MEMBER, [store_id, user_by_alias[user.alias], "staff"])
            else:
                cur.execute(_UPSERT_CUSTOMER, [store_id, user_by_alias[user.alias], user.alias])

        product_id_by_key: dict[str, Any] = {}
        for product in bundle.products:
            product_id_by_key[product.id] = _returning_id(
                cur,
                _UPSERT_PRODUCT,
                [
                    product.id,
                    store_id,
                    product.slug,
                    product.name,
                    product.category,
                    product.description,
                    product.color,
                    product.price_idr,
                    product.tags,
                    product.image_path,
                    product.image_alt,
                ],
            )

        variant_id_by_sku: dict[str, Any] = {}
        for variant in bundle.variants:
            variant_id_by_sku[variant.id] = _returning_id(
                cur,
                _UPSERT_VARIANT,
                [
                    variant.id,
                    product_id_by_key[variant.product_id],
                    variant.size_eu,
                    variant.stock,
                ],
            )

        policy_count = 0
        chunk_count = 0
        for policy in bundle.policies:
            policy_id = _returning_id(
                cur,
                _UPSERT_POLICY,
                [
                    policy.id,
                    store_id,
                    policy.title,
                    policy.version,
                    policy.effective_at,
                    policy.active,
                ],
            )
            policy_count += 1
            for index, chunk in enumerate(policy.chunks):
                cur.execute(
                    _UPSERT_POLICY_CHUNK,
                    [chunk.id, policy_id, index, chunk.section, chunk.text],
                )
                chunk_count += 1

        item_count = 0
        for order in bundle.orders:
            order_id = _returning_id(
                cur,
                _UPSERT_ORDER,
                [
                    store_id,
                    order.id,
                    user_by_alias[order.customer_alias],
                    order.status,
                    order.tracking_code,
                    order.eta_text,
                    order.updated_at,
                ],
            )
            for item in order.items:
                cur.execute(
                    _UPSERT_ORDER_ITEM,
                    [
                        order_id,
                        variant_id_by_sku[item.variant_id],
                        item.quantity,
                        item.unit_price_idr,
                    ],
                )
                item_count += 1

    return SeedSummary(
        target="local" if local_mode else "supabase",
        stores=1,
        users=len(users),
        products=len(bundle.products),
        variants=len(bundle.variants),
        orders=len(bundle.orders),
        order_items=item_count,
        policies=policy_count,
        policy_chunks=chunk_count,
    )


# ---------------------------------------------------------------- entry points


def run_seed(
    target: Target,
    settings: Settings,
    *,
    data_dir: Path = DATA_DIR,
    credentials_path: Path = CREDENTIALS_PATH,
) -> SeedSummary:
    """Validate fixtures, resolve synthetic auth users for the target, then upsert all rows."""
    check_guards(target, settings)
    bundle = load_fixtures(data_dir)
    users_in = synthetic_users(bundle)
    database_url = _database_url(settings)

    if target == "local":
        seeded = [
            SeededUser(
                alias=user.alias,
                email=user.email,
                auth_user_id=str(local_auth_user_id(user.alias)),
                role=user.role,
            )
            for user in users_in
        ]
        return _seed_database(database_url, bundle, seeded, local_mode=True)

    # check_guards guarantees both values are present for the supabase target.
    if settings.supabase_url is None or settings.supabase_service_role_key is None:
        raise SeedStop("BLOCKED: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    seeded, passwords = _resolve_supabase_users(
        users_in,
        settings.supabase_url,
        settings.supabase_service_role_key.get_secret_value(),
    )
    summary = _seed_database(database_url, bundle, seeded, local_mode=False)
    write_credentials_file(seeded, passwords, credentials_path)
    return summary


def _print_summary(summary: SeedSummary) -> None:
    print(
        f"seed OK target={summary.target} stores={summary.stores} users={summary.users} "
        f"products={summary.products} variants={summary.variants} orders={summary.orders} "
        f"order_items={summary.order_items} policies={summary.policies} "
        f"policy_chunks={summary.policy_chunks}",
        flush=True,
    )


def main(argv: Sequence[str] | None = None, settings: Settings | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tokolangkah_api.admin.seed")
    parser.add_argument("--target", required=True, choices=["local", "supabase"])
    args = parser.parse_args(argv)
    target: Target = "local" if args.target == "local" else "supabase"
    resolved = settings if settings is not None else Settings()
    try:
        summary = run_seed(target, resolved)
    except SeedStop as exc:
        print(str(exc), file=sys.stderr, flush=True)
        return EXIT_REFUSED
    except (FixtureError, SupabaseAdminError, SeedFailure) as exc:
        print(f"seed FAILED: {exc}", file=sys.stderr, flush=True)
        return EXIT_FAILED
    except psycopg.Error as exc:
        # Driver messages can contain the connection string: report the class only.
        print(f"seed FAILED: database error type={type(exc).__name__}", file=sys.stderr, flush=True)
        return EXIT_FAILED
    _print_summary(summary)
    return EXIT_SEEDED


if __name__ == "__main__":
    raise SystemExit(main())
