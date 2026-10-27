"""One bounded read of the public catalogue and policies, as the anon role (RLS applies).

Driver errors become StoreUnavailable carrying only the exception class: driver messages can contain
connection details.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import psycopg

from tokolangkah_api.assistant.errors import StoreUnavailable
from tokolangkah_api.db_session import anon_transaction


def run_anon_query(
    conn: psycopg.Connection[Any], sql: str, params: dict[str, Any] | Sequence[Any]
) -> list[tuple[Any, ...]]:
    try:
        with anon_transaction(conn) as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())
    except psycopg.Error as exc:
        raise StoreUnavailable(type(exc).__name__) from None
