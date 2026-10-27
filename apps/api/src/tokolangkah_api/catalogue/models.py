"""Response models for the public catalogue. Stock counts are deliberately absent."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field, StrictInt

SLUG_PATTERN = r"^[a-z0-9-]{1,64}$"


class SizeAvailability(BaseModel):
    size_eu: StrictInt
    in_stock: bool


class Product(BaseModel):
    id: str
    slug: str
    name: str
    category: str
    description: str
    color: str | None
    price_idr: Annotated[StrictInt, Field(ge=0)]
    tags: list[str]
    image_path: str | None
    image_alt: str
    sizes: list[SizeAvailability]


class ProductPage(BaseModel):
    items: list[Product]
    total: Annotated[int, Field(ge=0)]
