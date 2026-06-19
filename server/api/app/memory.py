"""
Long-term memory store (Phase 5).

This is distinct from store.py. store.py is the SHORT-TERM conversation
log — the literal back-and-forth, replayed verbatim on reconnect.
memory.py is LONG-TERM semantic memory — durable facts about Hamza,
his preferences, people, and ongoing projects — distilled from
conversation and recalled by meaning, not recency.

Design:
  - One SQLite DB at /data/memory.db (separate file so a reset is a
    clean wipe and never touches the conversation log).
  - Each memory is a short fact + a 384-dim embedding (from the embed
    service) + a type and importance weight.
  - Retrieval is brute-force cosine over all rows. For a single user
    this is at most a few hundred / low-thousand vectors — pure-Python
    cosine across 384 dims is sub-millisecond and needs no native
    vector extension or numpy.

Memory types mirror the .claude memory schema that works well:
  user      — who Hamza is (role, preferences, traits)
  feedback  — how he wants the assistant to behave
  project   — ongoing work / goals / constraints
  reference — pointers to external things (people, accounts, resources)

Embedding asymmetry: stored facts are embedded as "passage", incoming
search queries as "query" (bge wants the retrieval instruction only on
queries). The embed service handles that split via the `mode` field.

Best-effort everywhere: if the embed service is down, add()/search()
log and degrade gracefully rather than breaking the dialogue turn.
"""

from __future__ import annotations

import array
import math
import os
import sqlite3
import time
from pathlib import Path

import httpx
from loguru import logger


DEFAULT_DB_PATH = Path(os.environ.get("PERSONA_MEMORY_DB_PATH", "/data/memory.db"))

VALID_TYPES = ("user", "feedback", "project", "reference")

# Two facts this similar are treated as the same memory — adding the
# second just refreshes the first instead of creating a near-duplicate.
# 0.90 catches re-phrasings ("Hamza is vegetarian" vs "Hamza is a
# vegetarian") while staying clear of distinct-but-related facts
# ("Hamza likes coffee" vs "Hamza likes tea" sit well below this).
DEDUP_THRESHOLD = 0.90

# Floor for a memory to count as "relevant" to a query. bge-small puts
# genuinely related short facts comfortably above this; unrelated ones
# fall well below.
DEFAULT_MIN_SCORE = 0.35


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity. bge vectors come pre-normalized so this is
    ~= dot product, but we normalize defensively so a future model
    swap can't silently skew scores."""
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _pack(vec: list[float]) -> bytes:
    return array.array("f", vec).tobytes()


def _unpack(blob: bytes) -> list[float]:
    a = array.array("f")
    a.frombytes(blob)
    return a.tolist()


class MemoryStore:

    def __init__(self, path: Path, embed_url: str) -> None:
        self.path = path
        self.embed_url = embed_url.rstrip("/")
        self.path.parent.mkdir(parents=True, exist_ok=True)

        # check_same_thread=False: FastAPI may call us from different
        # worker threads. autocommit (isolation_level=None) keeps each
        # statement atomic with no explicit commit.
        self._conn = sqlite3.connect(
            str(self.path),
            check_same_thread=False,
            isolation_level=None,
        )
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                type       TEXT    NOT NULL DEFAULT 'user',
                content    TEXT    NOT NULL,
                importance REAL    NOT NULL DEFAULT 0.5,
                embedding  BLOB,
                source     TEXT    NOT NULL DEFAULT 'auto',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)"
        )

    # ── embedding helper ────────────────────────────────────────────────

    async def _embed(self, text: str, mode: str) -> list[float] | None:
        """Return one embedding vector, or None if the service is
        unreachable. Callers treat None as 'skip the vector step'."""
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                r = await c.post(
                    f"{self.embed_url}/embed",
                    json={"texts": [text], "mode": mode},
                )
                r.raise_for_status()
                embs = r.json().get("embeddings") or []
                return embs[0] if embs else None
        except Exception as e:
            logger.warning(f"memory: embed call failed ({mode}): {e}")
            return None

    # ── writes ──────────────────────────────────────────────────────────

    async def add(
        self,
        content: str,
        mem_type: str = "user",
        importance: float = 0.5,
        source: str = "auto",
    ) -> dict | None:
        """Add a memory. Semantically near-duplicate facts are merged
        into the existing row (importance bumped, timestamp refreshed)
        instead of inserting a duplicate. Returns the stored row dict,
        or None if content was empty."""
        content = (content or "").strip()
        if not content:
            return None

        if mem_type not in VALID_TYPES:
            mem_type = "user"
        importance = max(0.0, min(1.0, float(importance)))

        vec = await self._embed(content, mode="passage")

        # Dedup against existing vectors of the same type.
        if vec is not None:
            existing = self._all_rows()
            best_id = None
            best_score = 0.0
            for row in existing:
                if row["embedding"] is None or row["type"] != mem_type:
                    continue
                score = _cosine(vec, _unpack(row["embedding"]))
                if score > best_score:
                    best_score = score
                    best_id = row["id"]
            if best_id is not None and best_score >= DEDUP_THRESHOLD:
                now = int(time.time() * 1000)
                self._conn.execute(
                    "UPDATE memories SET importance = MAX(importance, ?), "
                    "updated_at = ? WHERE id = ?",
                    (importance, now, best_id),
                )
                logger.info(
                    f"memory: merged into #{best_id} "
                    f"(sim={best_score:.2f}) {content!r}"
                )
                return self.get(best_id)

        now = int(time.time() * 1000)
        cur = self._conn.execute(
            "INSERT INTO memories (type, content, importance, embedding, "
            "source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                mem_type,
                content,
                importance,
                _pack(vec) if vec is not None else None,
                source,
                now,
                now,
            ),
        )
        logger.info(f"memory: added #{cur.lastrowid} [{mem_type}] {content!r}")
        return self.get(cur.lastrowid)

    async def update(
        self,
        mem_id: int,
        content: str | None = None,
        mem_type: str | None = None,
        importance: float | None = None,
    ) -> dict | None:
        """Edit a memory. Re-embeds when the content changes so search
        stays accurate. Returns the updated row, or None if not found."""
        row = self.get(mem_id)
        if row is None:
            return None

        new_content = row["content"] if content is None else content.strip()
        new_type = row["type"] if mem_type is None else mem_type
        if new_type not in VALID_TYPES:
            new_type = row["type"]
        new_importance = (
            row["importance"] if importance is None
            else max(0.0, min(1.0, float(importance)))
        )

        embedding_blob = row["_embedding_blob"]
        if content is not None and new_content != row["content"]:
            vec = await self._embed(new_content, mode="passage")
            embedding_blob = _pack(vec) if vec is not None else None

        self._conn.execute(
            "UPDATE memories SET content = ?, type = ?, importance = ?, "
            "embedding = ?, updated_at = ? WHERE id = ?",
            (
                new_content,
                new_type,
                new_importance,
                embedding_blob,
                int(time.time() * 1000),
                mem_id,
            ),
        )
        logger.info(f"memory: updated #{mem_id}")
        return self.get(mem_id)

    def delete(self, mem_id: int) -> bool:
        cur = self._conn.execute("DELETE FROM memories WHERE id = ?", (mem_id,))
        deleted = cur.rowcount > 0
        if deleted:
            logger.info(f"memory: deleted #{mem_id}")
        return deleted

    def reset(self) -> int:
        """Wipe all memories. Returns how many were removed."""
        n = self.count()
        self._conn.execute("DELETE FROM memories")
        logger.info(f"memory: reset — cleared {n} memories")
        return n

    # ── reads ───────────────────────────────────────────────────────────

    def _all_rows(self) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT id, type, content, importance, embedding FROM memories"
        ).fetchall()

    def get(self, mem_id: int) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM memories WHERE id = ?", (mem_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def list_all(self) -> list[dict]:
        """All memories, most important first then newest. For 'what do
        you know about me' style recall and the management UI."""
        rows = self._conn.execute(
            "SELECT * FROM memories ORDER BY importance DESC, updated_at DESC"
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def count(self) -> int:
        return self._conn.execute(
            "SELECT COUNT(*) AS n FROM memories"
        ).fetchone()["n"]

    async def search(
        self,
        query: str,
        k: int = 5,
        min_score: float = DEFAULT_MIN_SCORE,
    ) -> list[dict]:
        """Return up to k memories most relevant to `query`, ranked by
        semantic similarity blended with a small importance nudge.
        Empty/degraded paths return an empty list — never raise."""
        query = (query or "").strip()
        if not query:
            return []

        qvec = await self._embed(query, mode="query")
        if qvec is None:
            return []

        scored: list[dict] = []
        for row in self._all_rows():
            if row["embedding"] is None:
                continue
            sim = _cosine(qvec, _unpack(row["embedding"]))
            if sim < min_score:
                continue
            # Importance gives a gentle tie-break without letting a
            # high-importance but irrelevant fact crowd out a relevant one.
            rank = sim + 0.05 * float(row["importance"])
            scored.append(
                {
                    "id": row["id"],
                    "type": row["type"],
                    "content": row["content"],
                    "importance": row["importance"],
                    "score": round(sim, 4),
                    "_rank": rank,
                }
            )

        scored.sort(key=lambda m: m["_rank"], reverse=True)
        for m in scored:
            m.pop("_rank", None)
        return scored[:k]

    # ── helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "type": row["type"],
            "content": row["content"],
            "importance": row["importance"],
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            # Internal: raw blob kept so update() can preserve the vector
            # when only non-content fields change. Not part of the public
            # API surface.
            "_embedding_blob": row["embedding"],
        }


# Module singleton, mirroring store.py. EMBED_URL comes from Settings
# (localhost by default, http://embed:8005 under compose).
from .config import settings  # noqa: E402  (after class def to avoid cycle noise)

memory = MemoryStore(DEFAULT_DB_PATH, settings.EMBED_URL)
