"""
SQLite-backed conversation store for Phase 4 Wave 4.3.

Persists the running dialogue across backend restarts so Violet
remembers what was said. Single-user-on-one-machine model — one
linear thread, no per-conversation partitioning. The store holds
the assistant's RAW reply text (with the emotion/animation tags
still embedded) so the model sees its own prior tag formatting
and stays consistent across restarts.

What this store DOES persist:
  - user text messages
  - assistant text replies (tagged, as returned by the model)

What it does NOT persist:
  - the system prompt (rebuilt from config/agent.json at startup)
  - intermediate tool_call / tool_response cycles (the final
    assistant text usually summarizes what happened, and skipping
    the cycles keeps the schema small and reload simple)

If we ever need full-fidelity tool history across restarts, the
schema gains a `tool_calls` JSON column on the assistant rows.
For now, simple wins.

Speed posture: synchronous sqlite3 with autocommit. Each turn is
a single INSERT (~ms) and each WS-connect is a single SELECT
LIMIT (~ms). No embedding cost, no vector store overhead, no
async wrapper. Fine for conversational pace.
"""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path


DEFAULT_DB_PATH = Path(
    os.environ.get("PERSONA_DB_PATH", "/data/violet.db")
)


class MessageStore:

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

        # check_same_thread=False because FastAPI may invoke us
        # from different worker threads. isolation_level=None puts
        # sqlite in autocommit mode — each statement is its own
        # transaction, no explicit commit needed.

        self._conn = sqlite3.connect(
            str(self.path),
            check_same_thread=False,
            isolation_level=None,
        )
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                role    TEXT    NOT NULL,
                content TEXT    NOT NULL,
                ts      INTEGER NOT NULL
            )
        """)
        # Most queries are "most recent N", served by the rowid
        # PK already. Index on ts is cheap insurance against future
        # time-range queries.
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts)"
        )

    def load_recent(self, limit: int = 60) -> list[dict]:
        """Return the last `limit` messages in chronological order
        (oldest first) — the shape ChatSession expects to splice
        in between the system prompt and live turns."""
        cur = self._conn.execute(
            "SELECT role, content FROM messages ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        rows = cur.fetchall()
        # Reverse to get chronological order (load_recent fetches
        # newest-first to honor the LIMIT cheaply).
        return [
            {"role": r["role"], "content": r["content"]}
            for r in reversed(rows)
        ]

    def append(self, role: str, content: str) -> None:
        """Append one message to the store."""
        if not content:
            return
        self._conn.execute(
            "INSERT INTO messages (role, content, ts) VALUES (?, ?, ?)",
            (role, content, int(time.time() * 1000)),
        )

    def clear(self) -> None:
        """Wipe all messages. Exposed for future maintenance tools."""
        self._conn.execute("DELETE FROM messages")


store = MessageStore(DEFAULT_DB_PATH)
