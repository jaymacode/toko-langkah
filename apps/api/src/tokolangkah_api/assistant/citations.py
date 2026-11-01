"""Citation validation, applied to every provider's draft answer.

Rules, per claim (one answer sentence with the evidence ids it cites):
1. Empty, over-long, or markup-containing text is dropped (answers are plain text, never HTML).
0. Claims that contain an order-number-shaped reference are dropped (order_reference).
2. Each cited id must be an Evidence id retrieved in THIS turn. Unknown ids are dropped;
   a claim left with no known id is dropped as uncited.
3. The claim needs lexical support in at least one cited excerpt: the share of its normalised
   tokens (lower-cased, NFKC, [a-z0-9]+) that occur in that excerpt must be at least
   SUPPORT_THRESHOLD (0.5). Unsupported claims are dropped.

If no claim survives, the answer is abstained. Token overlap is a weak check by design; it is
documented as such, and it never replaces the human-graded policy rubric.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from tokolangkah_api.assistant.policies import Evidence

SUPPORT_THRESHOLD: Final = 0.5
MAX_CLAIM_CHARS: Final = 600
_TAG_RE: Final = re.compile(r"<\s*/?\s*[a-zA-Z!][^>]*>")
_TOKEN_RE: Final = re.compile(r"[a-z0-9]+")
# An order-number-shaped reference (for example DEMO-1004). Policy text never needs one, and a
# customer must never see another customer's order identifier through retrieved text.
_ORDER_REFERENCE_RE: Final = re.compile(r"(?<![A-Za-z0-9-])[A-Za-z0-9]+-\d{3,}(?![0-9])")


def contains_order_reference(text: str) -> bool:
    return _ORDER_REFERENCE_RE.search(text) is not None


@dataclass(frozen=True)
class Claim:
    text: str
    citation_ids: tuple[str, ...]


@dataclass(frozen=True)
class SupportedSentence:
    text: str
    citation_ids: tuple[str, ...]


@dataclass(frozen=True)
class ValidatedAnswer:
    sentences: tuple[SupportedSentence, ...]
    dropped_reasons: tuple[str, ...]

    @property
    def abstained(self) -> bool:
        return not self.sentences

    @property
    def citation_ids(self) -> tuple[str, ...]:
        seen: dict[str, None] = {}
        for sentence in self.sentences:
            for citation_id in sentence.citation_ids:
                seen.setdefault(citation_id, None)
        return tuple(seen)

    @property
    def text(self) -> str:
        return " ".join(sentence.text for sentence in self.sentences)


def normalized_tokens(text: str) -> set[str]:
    folded = unicodedata.normalize("NFKC", text).lower()
    return set(_TOKEN_RE.findall(folded))


def support_ratio(sentence: str, excerpts: Iterable[str]) -> float:
    """Share of the sentence's tokens found in the excerpts. 0.0 for a sentence with no tokens."""
    wanted = normalized_tokens(sentence)
    if not wanted:
        return 0.0
    available: set[str] = set()
    for excerpt in excerpts:
        available |= normalized_tokens(excerpt)
    return len(wanted & available) / len(wanted)


def validate_claims(claims: Sequence[Claim], evidence: Mapping[str, Evidence]) -> ValidatedAnswer:
    kept: list[SupportedSentence] = []
    dropped: list[str] = []
    for claim in claims:
        text = claim.text.strip()
        if not text:
            dropped.append("empty")
            continue
        if len(text) > MAX_CLAIM_CHARS:
            dropped.append("too_long")
            continue
        if _TAG_RE.search(text):
            dropped.append("markup")
            continue
        if contains_order_reference(text):
            dropped.append("order_reference")
            continue
        known: list[str] = []
        for citation_id in dict.fromkeys(claim.citation_ids):
            if citation_id in evidence:
                known.append(citation_id)
            else:
                dropped.append("unknown_citation")
        if not known:
            dropped.append("uncited")
            continue
        supported = [
            citation_id
            for citation_id in known
            if support_ratio(text, [evidence[citation_id].excerpt]) >= SUPPORT_THRESHOLD
        ]
        if not supported:
            dropped.append("unsupported")
            continue
        kept.append(SupportedSentence(text=text, citation_ids=tuple(supported)))
    return ValidatedAnswer(sentences=tuple(kept), dropped_reasons=tuple(dropped))
