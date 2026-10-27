"""Minimal Supabase Auth Admin client for the seed script only.

Uses the service role key, which bypasses RLS and grants user administration. This module is
imported by the admin seed path only and never by request handling. Errors carry status codes or
exception class names, never response bodies, keys or passwords.
"""

from __future__ import annotations

import uuid
from typing import Self
from urllib.parse import urlsplit

import httpx

ADMIN_USERS_PATH = "/auth/v1/admin/users"
ADMIN_PAGE_SIZE = 200
ADMIN_MAX_PAGES = 50
ADMIN_TIMEOUT_SECONDS = 10.0
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost"})


class SupabaseAdminError(Exception):
    """Admin API call failed. The message contains no response body and no secret."""


def validate_supabase_url(url: str) -> str:
    """Require https, or http only for loopback (local Supabase CLI). Returns the normalised URL."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if not host:
        raise SupabaseAdminError("SUPABASE_URL has no host")
    if parts.scheme == "https":
        return url.rstrip("/")
    if parts.scheme == "http" and host in _LOOPBACK_HOSTS:
        return url.rstrip("/")
    raise SupabaseAdminError("SUPABASE_URL must use https (http is allowed only for loopback)")


def _user_list(payload: object) -> list[dict[str, object]]:
    raw: object = payload
    if isinstance(payload, dict):
        raw = payload.get("users")
    if not isinstance(raw, list):
        raise SupabaseAdminError("unexpected user list response shape")
    users: list[dict[str, object]] = []
    for item in raw:
        if isinstance(item, dict):
            users.append({str(key): value for key, value in item.items()})
    return users


class SupabaseAdmin:
    """Look up, create and password-rotate synthetic auth users through the Admin API."""

    def __init__(
        self,
        base_url: str,
        service_role_key: str,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=validate_supabase_url(base_url),
            headers={"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"},
            timeout=ADMIN_TIMEOUT_SECONDS,
            follow_redirects=False,
            transport=transport,
        )

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._client.close()

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, int] | None = None,
        json: dict[str, object] | None = None,
    ) -> object:
        try:
            response = self._client.request(method, path, params=params, json=json)
        except httpx.HTTPError as exc:
            raise SupabaseAdminError(
                f"Supabase Admin API unreachable: {type(exc).__name__}"
            ) from exc
        if response.status_code >= 400:
            raise SupabaseAdminError(f"Supabase Admin API returned HTTP {response.status_code}")
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise SupabaseAdminError("Supabase Admin API returned non-JSON") from exc

    def find_user_id_by_email(self, email: str) -> str | None:
        """Scan the paginated user list for an exact (case-insensitive) email match."""
        wanted = email.lower()
        for page in range(1, ADMIN_MAX_PAGES + 1):
            users = _user_list(
                self._request(
                    "GET",
                    ADMIN_USERS_PATH,
                    params={"page": page, "per_page": ADMIN_PAGE_SIZE},
                )
            )
            for user in users:
                if str(user.get("email", "")).lower() == wanted:
                    return _parse_user_id(user.get("id"))
            if len(users) < ADMIN_PAGE_SIZE:
                return None
        raise SupabaseAdminError("user list exceeded the page bound; refusing to guess")

    def create_user(self, email: str, password: str) -> str:
        payload = self._request(
            "POST",
            ADMIN_USERS_PATH,
            json={"email": email, "password": password, "email_confirm": True},
        )
        if not isinstance(payload, dict):
            raise SupabaseAdminError("unexpected create-user response shape")
        return _parse_user_id(payload.get("id"))

    def set_password(self, user_id: str, password: str) -> None:
        self._request("PUT", f"{ADMIN_USERS_PATH}/{user_id}", json={"password": password})


def _parse_user_id(value: object) -> str:
    if not isinstance(value, str):
        raise SupabaseAdminError("user id missing from Admin API response")
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise SupabaseAdminError("user id is not a UUID") from exc
