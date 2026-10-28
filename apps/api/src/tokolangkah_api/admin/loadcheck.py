"""Local in-process load check for the assistant turn API.

Runs N customer turns through the real FastAPI app (TestClient, no network listener) against a
local, migrated and seeded PostgreSQL database, with the deterministic rules provider. It reports
p50/p95/max latency per intent and an error count, and writes artifacts/perf/<timestamp>.json.

Scope and limits (also written into the artifact):
- local, in-process, rules provider. The rules planner is a demo planner, not AI, so these numbers
  say nothing about model latency, cost or answer quality.
- Tokens are signed by an ephemeral ES256 key created in this process. It is never written to disk.
- Turns run as the seeded synthetic customer-a. Rows created by the run (conversation, messages,
  tickets, rate-limit counters) are deleted at the end.

Run from apps/api:  uv run python -m tokolangkah_api.admin.loadcheck --turns 50
Needs DATABASE_URL in the environment (never read from a .env file here). Without it the run
exits 2 with BLOCKED. Setup and cleanup use DATABASE_URL (table owner). The app's turns use
API_DATABASE_URL when it is set, which is the restricted API role (migration 0007). Set it to
measure the production privilege model.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import jwt
import psycopg
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from pydantic import SecretStr

from tokolangkah_api.auth import TokenRejected, get_signing_key_provider
from tokolangkah_api.main import create_app
from tokolangkah_api.settings import AppEnv, AssistantProvider, Settings

EXIT_OK: Final = 0
EXIT_SERVER_ERRORS: Final = 1
EXIT_BLOCKED: Final = 2
LOADCHECK_SUPABASE_URL: Final = "https://loadcheck.invalid"
LOADCHECK_KID: Final = "loadcheck-ephemeral"
CUSTOMER_ALIAS_PREFIX: Final = "customer-a"
SCOPE_NOTE: Final = "local, in-process, rules provider"
MAX_TURNS: Final = 1000

# One message per intent. The planner route is deterministic for these texts; the artifact also
# records the observed next_action per intent so a mismatch is visible, not hidden.
INTENT_MESSAGES: Final[dict[str, str]] = {
    "policy": "Bisa retur berapa hari?",
    "product": "Cari sepatu krem ukuran 38",
    "order": "Status pesanan DEMO-1001 saya?",
    "handoff": "Saya ingin bicara dengan staf",
}
INTENT_ORDER: Final = ("policy", "product", "order", "handoff")


class _EphemeralKeys:
    """One in-process public key for the signature check. Never persisted or printed."""

    issuer = f"{LOADCHECK_SUPABASE_URL}/auth/v1"

    def __init__(self, public_key: ec.EllipticCurvePublicKey) -> None:
        self._public_key = public_key

    def key_for_token(self, token: str) -> Any:
        if jwt.get_unverified_header(token).get("kid") != LOADCHECK_KID:
            raise TokenRejected("unknown_key")
        return self._public_key


@dataclass
class IntentStats:
    latencies_ms: list[float] = field(default_factory=list)
    errors: int = 0
    next_actions: dict[str, int] = field(default_factory=dict)


def percentile(values: list[float], pct: float) -> float | None:
    """Nearest-rank percentile. None for an empty sample."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


def summarize(stats: IntentStats) -> dict[str, Any]:
    latencies = stats.latencies_ms
    return {
        "sample_size": len(latencies),
        "p50_ms": _round(percentile(latencies, 50)),
        "p95_ms": _round(percentile(latencies, 95)),
        "max_ms": _round(max(latencies) if latencies else None),
        "errors": stats.errors,
        "observed_next_action": dict(sorted(stats.next_actions.items())),
    }


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def _customer_user_id(database_url: str) -> uuid.UUID | None:
    with psycopg.connect(database_url) as conn:
        row = conn.execute(
            "SELECT cu.user_id FROM customers AS cu JOIN stores AS s ON s.id = cu.store_id"
            " WHERE s.external_id = 'store-demo' AND cu.alias LIKE %s ORDER BY cu.alias LIMIT 1",
            (f"{CUSTOMER_ALIAS_PREFIX}%",),
        ).fetchone()
    return row[0] if row is not None else None


def _cleanup(database_url: str, user_id: uuid.UUID, conversation_ids: list[str]) -> None:
    with psycopg.connect(database_url) as conn:
        for conversation_id in conversation_ids:
            # Tickets reference the conversation without cascade; messages cascade from it.
            conn.execute("DELETE FROM tickets WHERE conversation_id = %s", (conversation_id,))
            conn.execute("DELETE FROM conversations WHERE id = %s", (conversation_id,))
        conn.execute(
            "DELETE FROM tokolangkah_private.chat_rate_limits WHERE user_id = %s", (user_id,)
        )
        conn.commit()


def run_loadcheck(
    turns: int, database_url: str, api_database_url: str | None = None
) -> dict[str, Any]:
    """Run `turns` customer turns in-process and return the report (not yet written to disk)."""
    user_id = _customer_user_id(database_url)
    if user_id is None:
        raise LookupError("seeded customer-a is missing")

    private_key = ec.generate_private_key(ec.SECP256R1())
    keys = _EphemeralKeys(private_key.public_key())
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        app_env=AppEnv.TEST,
        database_url=SecretStr(database_url),
        api_database_url=SecretStr(api_database_url) if api_database_url else None,
        supabase_url=LOADCHECK_SUPABASE_URL,
        assistant_provider=AssistantProvider.RULES,
        # The shared window must not throttle the measurement itself.
        assistant_rate_limit_turns=max(10, turns + 10),
    )
    app = create_app(settings)
    app.dependency_overrides[get_signing_key_provider] = lambda: keys
    client = TestClient(app, raise_server_exceptions=False)

    now = int(time.time())
    token = jwt.encode(
        {
            "sub": str(user_id),
            "aud": "authenticated",
            "iss": keys.issuer,
            "iat": now,
            "exp": now + 3600,
            "role": "authenticated",
        },
        private_key,
        algorithm="ES256",
        headers={"kid": LOADCHECK_KID},
    )
    headers = {"Authorization": f"Bearer {token}"}

    stats: dict[str, IntentStats] = {name: IntentStats() for name in INTENT_ORDER}
    status_counts: dict[str, int] = {}
    conversation_ids: list[str] = []
    server_errors = 0
    started = time.perf_counter()

    def new_conversation() -> str:
        created = client.post("/conversations", headers=headers)
        if created.status_code != 201:
            raise RuntimeError(f"could not create a conversation (status {created.status_code})")
        conversation_id: str = created.json()["id"]
        conversation_ids.append(conversation_id)
        return conversation_id

    try:
        conversation_id = new_conversation()
        for index in range(turns):
            intent = INTENT_ORDER[index % len(INTENT_ORDER)]
            body = {
                "content": INTENT_MESSAGES[intent],
                "client_message_id": str(uuid.uuid4()),
            }
            t0 = time.perf_counter()
            response = client.post(
                f"/conversations/{conversation_id}/messages", json=body, headers=headers
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000
            bucket = stats[intent]
            bucket.latencies_ms.append(elapsed_ms)
            status_counts[str(response.status_code)] = (
                status_counts.get(str(response.status_code), 0) + 1
            )
            if response.status_code == 200:
                action = str(response.json().get("next_action"))
                bucket.next_actions[action] = bucket.next_actions.get(action, 0) + 1
            else:
                bucket.errors += 1
                if response.status_code >= 500:
                    server_errors += 1
            if intent == "handoff":
                # The open ticket hands the conversation to staff (0011): later assistant turns
                # would not run the assistant, so the next intent starts a fresh conversation.
                conversation_id = new_conversation()
    finally:
        _cleanup(database_url, user_id, conversation_ids)
    wall_seconds = time.perf_counter() - started

    total_errors = sum(item.errors for item in stats.values())
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "scope": SCOPE_NOTE,
        "provider": "rules",
        "commit": "not recorded (local run)",
        "turns_requested": turns,
        "sample_size": sum(len(item.latencies_ms) for item in stats.values()),
        "errors": total_errors,
        "server_errors": server_errors,
        "status_counts": dict(sorted(status_counts.items())),
        "wall_clock_seconds": round(wall_seconds, 2),
        "latency_basis": "client round trip in-process, all attempts including errors",
        "intents": {name: summarize(stats[name]) for name in INTENT_ORDER},
        "notes": [
            SCOPE_NOTE,
            "not a model benchmark: no live provider was called",
            "rows created by the run were deleted afterwards",
        ],
    }


def write_report(report: dict[str, Any], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"{stamp}.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local in-process turn load check (rules).")
    parser.add_argument("--turns", type=int, default=50, help=f"turns to run (1..{MAX_TURNS})")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parents[5] / "artifacts" / "perf",
        help="directory for the JSON report (default: <repo>/artifacts/perf, gitignored)",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.turns <= MAX_TURNS:
        parser.error(f"--turns must be between 1 and {MAX_TURNS}")

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("BLOCKED: DATABASE_URL is not set (loadcheck needs the local database)")
        return EXIT_BLOCKED

    try:
        api_database_url = os.environ.get("API_DATABASE_URL", "").strip() or None
        report = run_loadcheck(args.turns, database_url, api_database_url)
    except (psycopg.Error, LookupError, RuntimeError) as exc:
        # Only the class: driver messages can contain the connection string.
        print(f"BLOCKED: loadcheck could not run ({type(exc).__name__})")
        return EXIT_BLOCKED

    path = write_report(report, args.out_dir)
    print(json.dumps({k: report[k] for k in ("sample_size", "errors", "status_counts")}))
    for name in INTENT_ORDER:
        item = report["intents"][name]
        print(
            f"{name}: n={item['sample_size']} p50={item['p50_ms']}ms p95={item['p95_ms']}ms"
            f" max={item['max_ms']}ms errors={item['errors']}"
        )
    print(f"report: {path}")
    return EXIT_SERVER_ERRORS if report["server_errors"] else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
