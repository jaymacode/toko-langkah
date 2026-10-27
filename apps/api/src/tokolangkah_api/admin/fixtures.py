"""Strict Pydantic models for the synthetic fixture files in data/, plus cross-file checks.

Money is integer IDR (StrictInt: no floats, no numeric strings). Sizes are integer EU sizes.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    TypeAdapter,
    ValidationError,
)

REPO_ROOT = Path(__file__).resolve().parents[5]
DATA_DIR = REPO_ROOT / "data"
DEMO_STORE_ID = "store-demo"

SLUG_PATTERN = r"^[a-z0-9-]{1,64}$"
_NON_EMPTY = Field(min_length=1)


class FixtureError(Exception):
    """Raised when a fixture file is unreadable, malformed, or inconsistent with another file."""


class _FixtureModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class FixtureProduct(_FixtureModel):
    id: Annotated[str, _NON_EMPTY]
    store_id: Annotated[str, _NON_EMPTY]
    slug: Annotated[str, Field(pattern=SLUG_PATTERN)]
    name: Annotated[str, _NON_EMPTY]
    category: Annotated[str, _NON_EMPTY]
    description: str
    color: str | None
    currency: Literal["IDR"]
    price_idr: Annotated[StrictInt, Field(ge=0)]
    tags: list[str]
    image_path: Annotated[str, Field(pattern=r"^/products/[a-z0-9-]+\.png$")]
    image_alt: Annotated[str, _NON_EMPTY]
    synthetic: Literal[True]


class FixtureVariant(_FixtureModel):
    id: Annotated[str, _NON_EMPTY]
    product_id: Annotated[str, _NON_EMPTY]
    size_eu: Annotated[StrictInt, Field(ge=30, le=50)]
    stock: Annotated[StrictInt, Field(ge=0)]


class FixtureOrderItem(_FixtureModel):
    variant_id: Annotated[str, _NON_EMPTY]
    quantity: Annotated[StrictInt, Field(ge=1)]
    unit_price_idr: Annotated[StrictInt, Field(ge=0)]


class FixtureOrder(_FixtureModel):
    id: Annotated[str, _NON_EMPTY]  # Fixture order number, e.g. DEMO-1001.
    store_id: Annotated[str, _NON_EMPTY]
    customer_alias: Annotated[str, _NON_EMPTY]
    status: Annotated[str, _NON_EMPTY]
    tracking_code: str | None
    eta_text: str | None
    updated_at: AwareDatetime
    items: Annotated[list[FixtureOrderItem], Field(min_length=1)]
    synthetic: Literal[True]


class FixtureCustomer(_FixtureModel):
    alias: Annotated[str, _NON_EMPTY]
    email: Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    auth_user_id: None
    store_id: Annotated[str, _NON_EMPTY]


class FixturePolicyChunk(_FixtureModel):
    id: Annotated[str, _NON_EMPTY]
    section: Annotated[str, _NON_EMPTY]
    text: Annotated[str, _NON_EMPTY]


class FixturePolicy(_FixtureModel):
    id: Annotated[str, _NON_EMPTY]
    store_id: Annotated[str, _NON_EMPTY]
    title: Annotated[str, _NON_EMPTY]
    version: Annotated[str, _NON_EMPTY]
    effective_at: AwareDatetime
    active: bool
    chunks: Annotated[list[FixturePolicyChunk], Field(min_length=1)]
    synthetic: Literal[True]


@dataclass(frozen=True)
class FixtureBundle:
    products: list[FixtureProduct]
    variants: list[FixtureVariant]
    orders: list[FixtureOrder]
    customers: list[FixtureCustomer]
    policies: list[FixturePolicy]


def _format_validation_error(filename: str, exc: ValidationError) -> str:
    # Only locations and messages: input values are not echoed back.
    details = "; ".join(
        f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
        for error in exc.errors(include_input=False, include_url=False)[:5]
    )
    return f"{filename} failed validation ({exc.error_count()} error(s)): {details}"


_PRODUCTS: TypeAdapter[list[FixtureProduct]] = TypeAdapter(list[FixtureProduct])
_VARIANTS: TypeAdapter[list[FixtureVariant]] = TypeAdapter(list[FixtureVariant])
_ORDERS: TypeAdapter[list[FixtureOrder]] = TypeAdapter(list[FixtureOrder])
_CUSTOMERS: TypeAdapter[list[FixtureCustomer]] = TypeAdapter(list[FixtureCustomer])
_POLICIES: TypeAdapter[list[FixturePolicy]] = TypeAdapter(list[FixturePolicy])


def _read_list[M](data_dir: Path, filename: str, adapter: TypeAdapter[list[M]]) -> list[M]:
    path = data_dir / filename
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FixtureError(f"{filename} could not be read: {type(exc).__name__}") from exc
    try:
        return adapter.validate_python(raw)
    except ValidationError as exc:
        raise FixtureError(_format_validation_error(filename, exc)) from exc


def load_fixtures(data_dir: Path = DATA_DIR) -> FixtureBundle:
    """Load and validate every catalogue, order, customer and policy fixture file."""
    bundle = FixtureBundle(
        products=_read_list(data_dir, "products.json", _PRODUCTS),
        variants=_read_list(data_dir, "product_variants.json", _VARIANTS),
        orders=_read_list(data_dir, "orders.json", _ORDERS),
        customers=_read_list(data_dir, "customers.json", _CUSTOMERS),
        policies=_read_list(data_dir, "policies.json", _POLICIES),
    )
    validate_bundle(bundle)
    return bundle


def _duplicates(values: list[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


def validate_bundle(bundle: FixtureBundle) -> None:
    """Cross-file checks that a single-model validator cannot express."""
    problems: list[str] = []

    product_ids = [p.id for p in bundle.products]
    product_id_set = set(product_ids)
    for name, dupes in (
        ("product ids", _duplicates(product_ids)),
        ("product slugs", _duplicates([p.slug for p in bundle.products])),
        ("variant skus", _duplicates([v.id for v in bundle.variants])),
        ("order numbers", _duplicates([o.id for o in bundle.orders])),
        ("customer aliases", _duplicates([c.alias for c in bundle.customers])),
        ("customer emails", _duplicates([c.email for c in bundle.customers])),
        ("policy ids", _duplicates([p.id for p in bundle.policies])),
        (
            "policy chunk ids",
            _duplicates([chunk.id for policy in bundle.policies for chunk in policy.chunks]),
        ),
    ):
        if dupes:
            problems.append(f"duplicate {name}: {', '.join(dupes)}")

    variant_skus = {v.id for v in bundle.variants}
    size_keys = [f"{v.product_id}|{v.size_eu}" for v in bundle.variants]
    problems.extend(
        f"variant {v.id} references unknown product {v.product_id}"
        for v in bundle.variants
        if v.product_id not in product_id_set
    )
    problems.extend(f"duplicate size for product key {key}" for key in _duplicates(size_keys))

    aliases = {c.alias for c in bundle.customers}
    for order in bundle.orders:
        if order.customer_alias not in aliases:
            problems.append(f"order {order.id} references unknown customer alias")
        problems.extend(
            f"order {order.id} references unknown variant {item.variant_id}"
            for item in order.items
            if item.variant_id not in variant_skus
        )

    store_ids = [
        *(p.store_id for p in bundle.products),
        *(o.store_id for o in bundle.orders),
        *(c.store_id for c in bundle.customers),
        *(p.store_id for p in bundle.policies),
    ]
    if any(store_id != DEMO_STORE_ID for store_id in store_ids):
        problems.append(f"every fixture store_id must be {DEMO_STORE_ID}")

    active_titles = [p.title for p in bundle.policies if p.active]
    problems.extend(
        f"more than one active policy titled {title}" for title in _duplicates(active_titles)
    )

    if problems:
        raise FixtureError("fixture consistency check failed: " + " | ".join(problems))
