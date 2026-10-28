"""Embeddings for hybrid retrieval: one batched request per call, budget-guarded, dimension-checked.

Model and version: every vector is labelled with embedding_version = "<model>:1536". Rows are only
compared with a query vector of the same version; a model or dimension change needs a re-embed.
Dimensions are fixed at 1536. A response with another length is refused, never stored.

Budget: before the single request the worst case (estimated input tokens x embedding price) is added
to the shared ledger total; the call is refused if that exceeds LIVE_EVAL_BUDGET_USD. After the call
the measured prompt tokens are recorded. Only counts and cost are kept, never the texts.

Retries: none. A batch is one request, so the request count is exactly what the caller can predict.

FakeEmbedder is deterministic plumbing only (hashed bag of words, no semantics). It is used by tests
and by `--mode retrieval-fixture`, and is never selected by configuration.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Protocol

import openai

from tokolangkah_api.assistant.errors import AssistantUnavailable
from tokolangkah_api.assistant.spend import SpendPolicy, estimate_input_tokens

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS: Final = 1536
MAX_BATCH_INPUTS: Final = 2048  # OpenAI limit for one embeddings request
CALL_TIMEOUT_SECONDS: Final = 20.0
FAKE_VERSION: Final = f"fake-hashed-bow:{EMBEDDING_DIMENSIONS}"
_TOKEN_RE: Final = re.compile(r"[a-z0-9]+")


def embedding_version(model: str) -> str:
    return f"{model}:{EMBEDDING_DIMENSIONS}"


def vector_literal(vector: Sequence[float]) -> str:
    """pgvector text form, passed as a bound parameter and cast with ::extensions.vector."""
    return "[" + ",".join(repr(float(x)) for x in vector) + "]"


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def policy_embedding_text(title: str, section: str, text: str) -> str:
    return f"{title}\n{section}\n{text}"


def product_embedding_text(
    name: str, category: str, color: str | None, description: str, tags: Sequence[str]
) -> str:
    return "\n".join([name, category, color or "", description, " ".join(tags)])


class Embedder(Protocol):
    @property
    def version(self) -> str: ...

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class _EmbeddingsCreateLike(Protocol):
    def create(self, **kwargs: Any) -> Any: ...


class EmbeddingClientLike(Protocol):
    embeddings: _EmbeddingsCreateLike


@dataclass
class EmbeddingUsage:
    """Counts and cost of one embeddings request. Never content."""

    inputs: int
    input_tokens: int
    cost_usd: str  # decimal string, exact
    usage_reported: bool


@dataclass
class OpenAIEmbedder:
    client: EmbeddingClientLike
    model: str
    spend: SpendPolicy
    usages: list[EmbeddingUsage] = field(default_factory=list)
    requests: int = 0
    budget_refusals: int = 0

    @property
    def version(self) -> str:
        return embedding_version(self.model)

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Embed all texts in ONE request. Raises AssistantUnavailable; never partial data."""
        if not texts:
            return []
        if len(texts) > MAX_BATCH_INPUTS:
            raise AssistantUnavailable("embedding_batch_too_large")
        if any(not text.strip() for text in texts):
            raise ValueError("embedding input must not be empty")
        input_estimate = estimate_input_tokens(list(texts))
        self._guard(input_estimate)
        try:
            response = self.client.embeddings.create(
                model=self.model,
                input=list(texts),
                # Always ask for the column width: larger native vectors (nemotron-3.5-embed-8b,
                # 4096) are truncated to it; text-embedding-3-small is 1536 already.
                dimensions=EMBEDDING_DIMENSIONS,
                timeout=CALL_TIMEOUT_SECONDS,
            )
        except openai.APIError as exc:
            # Diagnostics only (e.g. 429 credit_balance_exhausted): status and code, never content.
            logger.warning(
                "embedding call failed status=%s code=%s",
                getattr(exc, "status_code", None),
                getattr(exc, "code", None),
            )
            raise AssistantUnavailable("embedding_provider_error") from None
        self.requests += 1
        self._record(response, input_estimate, len(texts))
        return _vectors(response, len(texts))

    def _guard(self, input_estimate: int) -> None:
        budget = self.spend.budget_usd
        if budget <= 0:
            self.budget_refusals += 1
            raise AssistantUnavailable("budget_exhausted")
        worst = self.spend.worst_case(input_estimate)
        if self.spend.ledger.total_usd() + worst > budget:
            self.budget_refusals += 1
            raise AssistantUnavailable("budget_exhausted")

    def _record(self, response: Any, input_estimate: int, inputs: int) -> None:
        usage = getattr(response, "usage", None)
        prompt = getattr(usage, "prompt_tokens", None)
        reported = isinstance(prompt, int)
        input_tokens = prompt if isinstance(prompt, int) else input_estimate
        cost = self.spend.cost(input_tokens, 0)
        self.spend.ledger.record(
            source=self.spend.source,
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=0,
            cost_usd=cost,
            request_id=uuid.uuid4().hex,
        )
        self.usages.append(
            EmbeddingUsage(
                inputs=inputs,
                input_tokens=input_tokens,
                cost_usd=str(cost),
                usage_reported=reported,
            )
        )


def _vectors(response: Any, expected: int) -> list[list[float]]:
    """Order by index, then check count and dimension. Any mismatch is refused."""
    data = list(getattr(response, "data", None) or [])
    if len(data) != expected:
        raise AssistantUnavailable("embedding_count_mismatch")
    ordered = sorted(data, key=lambda item: int(getattr(item, "index", -1)))
    if [int(item.index) for item in ordered] != list(range(expected)):
        raise AssistantUnavailable("embedding_count_mismatch")
    vectors: list[list[float]] = []
    for item in ordered:
        values = [float(x) for x in item.embedding]
        if len(values) != EMBEDDING_DIMENSIONS:
            raise AssistantUnavailable("embedding_dimension_mismatch")
        if not all(math.isfinite(x) for x in values):
            raise AssistantUnavailable("embedding_dimension_mismatch")
        vectors.append(values)
    return vectors


class FakeEmbedder:
    """Deterministic hashed bag-of-words vectors. Plumbing only: no semantics, never configured."""

    def __init__(self) -> None:
        self.requests = 0

    @property
    def version(self) -> str:
        return FAKE_VERSION

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        self.requests += 1
        return [fake_vector(text) for text in texts]


def fake_vector(text: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIMENSIONS
    for token in _TOKEN_RE.findall(text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS
        vector[index] += 1.0 if digest[4] & 1 else -1.0
    norm = math.sqrt(sum(x * x for x in vector))
    if norm == 0.0:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        vector[int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS] = 1.0
        norm = 1.0
    return [x / norm for x in vector]
