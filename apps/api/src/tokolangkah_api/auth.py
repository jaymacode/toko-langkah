"""Verified identity for API requests: Supabase ES256 access tokens checked with PyJWT.

Checks, in order: bearer format, header algorithm must be exactly ES256 (no HS256, no none),
signing key from the JWKS source, signature, exp (leeway 30 s), iss, aud, required claims, and sub
as a canonical UUID. Any failure is a 401 with the generic `unauthorized` envelope. Only the failure
class is logged, never the token or the claims.

The key source is a FastAPI dependency (get_signing_key_provider). Tests replace it with
app.dependency_overrides; there is no environment-variable or header bypass.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Protocol

import jwt
from fastapi import Depends, HTTPException, Request

from tokolangkah_api.db_session import ServiceUnavailable

ALGORITHM = "ES256"
AUDIENCE = "authenticated"
LEEWAY_SECONDS = 30
JWKS_CACHE_SECONDS = 600
JWKS_TIMEOUT_SECONDS = 5
MAX_TOKEN_LENGTH = 8192
REQUIRED_CLAIMS = ["exp", "iss", "aud", "sub"]

logger = logging.getLogger(__name__)


class TokenRejected(Exception):
    """The token is not acceptable. failure_class is a short fixed label, safe to log."""

    def __init__(self, failure_class: str) -> None:
        super().__init__(failure_class)
        self.failure_class = failure_class


class SigningKeyUnavailable(ServiceUnavailable):
    """The JWKS could not be fetched or is not configured. This is a 503, not an invalid token."""


class SigningKeyProvider(Protocol):
    """Source of verification keys for one trusted issuer."""

    issuer: str

    def key_for_token(self, token: str) -> Any:
        """Return the public key for this token's kid.

        Raises TokenRejected for an unknown key and SigningKeyUnavailable for a fetch failure.
        """
        ...


class SupabaseSigningKeys:
    """Fetches and caches the project JWKS from SUPABASE_URL with a bounded timeout."""

    def __init__(self, supabase_url: str) -> None:
        self.issuer = f"{supabase_url}/auth/v1"
        jwks_url = f"{self.issuer}/.well-known/jwks.json"
        self._client = jwt.PyJWKClient(
            jwks_url,
            cache_keys=True,
            lifespan=JWKS_CACHE_SECONDS,
            timeout=JWKS_TIMEOUT_SECONDS,
        )

    def key_for_token(self, token: str) -> Any:
        try:
            return self._client.get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientConnectionError as exc:
            raise SigningKeyUnavailable("jwks fetch failed") from exc
        except jwt.PyJWTError as exc:
            raise TokenRejected("unknown_key") from exc


class UnconfiguredSigningKeys:
    """Used when SUPABASE_URL is not set: every request needing a key fails with a 503."""

    issuer = ""

    def key_for_token(self, token: str) -> Any:
        raise SigningKeyUnavailable("SUPABASE_URL is not configured")


def user_hash(user_id: uuid.UUID) -> str:
    """Short, non-reversible identifier for logs. The user id itself is never logged."""
    return hashlib.sha256(str(user_id).encode("ascii")).hexdigest()[:12]


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: uuid.UUID


def verify_access_token(token: str, keys: SigningKeyProvider) -> uuid.UUID:
    """Return the verified subject of the token or raise TokenRejected."""
    if not token or len(token) > MAX_TOKEN_LENGTH:
        raise TokenRejected("malformed")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise TokenRejected("malformed") from exc
    # Reject any other algorithm before a key is even looked up. This blocks alg=none and HS256 with
    # the public key bytes used as an HMAC secret.
    if header.get("alg") != ALGORITHM:
        raise TokenRejected("algorithm")

    key = keys.key_for_token(token)
    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            issuer=keys.issuer,
            leeway=LEEWAY_SECONDS,
            options={"require": REQUIRED_CLAIMS},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenRejected("expired") from exc
    except jwt.InvalidAudienceError as exc:
        raise TokenRejected("audience") from exc
    except jwt.InvalidIssuerError as exc:
        raise TokenRejected("issuer") from exc
    except jwt.InvalidSignatureError as exc:
        raise TokenRejected("signature") from exc
    except jwt.MissingRequiredClaimError as exc:
        raise TokenRejected("missing_claim") from exc
    except jwt.PyJWTError as exc:
        raise TokenRejected("invalid") from exc

    subject = claims.get("sub")
    if not isinstance(subject, str):
        raise TokenRejected("subject")
    try:
        parsed = uuid.UUID(subject)
    except ValueError as exc:
        raise TokenRejected("subject") from exc
    if str(parsed) != subject:
        raise TokenRejected("subject")
    return parsed


def get_signing_key_provider(request: Request) -> SigningKeyProvider:
    """Dependency: the JWKS source for this app. Created once per app from settings, then cached."""
    state = request.app.state
    cached: SigningKeyProvider | None = getattr(state, "signing_keys", None)
    if cached is not None:
        return cached
    supabase_url: str | None = state.settings.supabase_url
    provider: SigningKeyProvider = (
        SupabaseSigningKeys(supabase_url) if supabase_url else UnconfiguredSigningKeys()
    )
    state.signing_keys = provider
    return provider


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    parts = header.split(maxsplit=1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401)
    return parts[1].strip()


def current_user(
    request: Request,
    keys: Annotated[SigningKeyProvider, Depends(get_signing_key_provider)],
) -> AuthenticatedUser:
    """Dependency for every user-scoped route. Returns the verified user or raises 401."""
    token = _bearer_token(request)
    try:
        user_id = verify_access_token(token, keys)
    except TokenRejected as exc:
        logger.info("auth rejected failure_class=%s", exc.failure_class)
        raise HTTPException(status_code=401) from exc
    # Only the short hash reaches the request log line (see middleware.RequestLogMiddleware).
    request.scope.setdefault("state", {})["user_hash"] = user_hash(user_id)
    return AuthenticatedUser(user_id=user_id)
