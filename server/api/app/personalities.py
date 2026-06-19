"""
Switchable personalities.

Each personality is a JSON file in server/config/personalities/ holding
the personality-specific half of the system prompt plus its voice and
default emotion. The structural rules of the prompt (response style,
emotion/animation tags, tool usage) stay shared in llm.py — only the
"who she is" block swaps when the personality changes.

The active personality is a single global selection (single-user app),
persisted to /data so it survives restarts and seeds new sessions.

Switching happens over the chat WebSocket (`set_personality` control
frame from the tray or a "switch to X" phrase); main.py rebuilds the
live session's system prompt and tells the client the new voice.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from loguru import logger


DEFAULT_ID = "angry_gf"

_DIR_CANDIDATES = [
    Path("/app/config/personalities"),
    Path(__file__).resolve().parent.parent.parent / "config" / "personalities",
]

# Deep mode lives in its own file OUTSIDE the personalities dir so it never
# lands in the public roster (tray list / switch matcher). It's a gated
# toggle, not a pick-from-the-list personality.
_ADULT_CANDIDATES = [
    Path("/app/config/deep_mode.json"),
    Path(__file__).resolve().parent.parent.parent / "config" / "deep_mode.json",
]

ACTIVE_PATH = Path(
    os.environ.get("PERSONA_ACTIVE_PERSONALITY_PATH", "/data/active_personality.txt")
)


def _personalities_dir() -> Path | None:
    for d in _DIR_CANDIDATES:
        if d.is_dir():
            return d
    return None


class PersonalityStore:

    def __init__(self) -> None:
        self._items: dict[str, dict] = {}
        self._load()
        self._active = self._load_active()
        self._adult = self._load_adult()

    # ── loading ─────────────────────────────────────────────────────

    def _load(self) -> None:
        d = _personalities_dir()
        if not d:
            logger.warning("personalities: no config dir found; using none")
            return
        for path in sorted(d.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                pid = data.get("id") or path.stem
                data["id"] = pid
                data.setdefault("name", pid.replace("_", " ").title())
                data.setdefault("voice", "")
                data.setdefault("default_emotion", "relaxed")
                data.setdefault("prompt", "")
                self._items[pid] = data
            except Exception as e:
                logger.warning(f"personalities: failed to load {path.name}: {e}")
        logger.info(
            f"personalities: loaded {len(self._items)} "
            f"({', '.join(self._items)})"
        )

    def _load_adult(self) -> dict | None:
        """Load the adult-mode personality from its standalone file. Kept
        separate from _items so it's never exposed in the roster."""
        for path in _ADULT_CANDIDATES:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                data.setdefault("id", "intimate")
                data.setdefault("name", "Deep Mode")
                data.setdefault("voice", "")
                data.setdefault("default_emotion", "relaxed")
                data.setdefault("prompt", "")
                logger.info("personalities: deep mode config loaded")
                return data
            except FileNotFoundError:
                continue
            except Exception as e:
                logger.warning(f"personalities: failed to load adult config: {e}")
                return None
        logger.info("personalities: no deep mode config found")
        return None

    def adult(self) -> dict | None:
        """The adult-mode personality (prompt + voice + emotion), or None
        if no config is present."""
        return self._adult

    def _load_active(self) -> str:
        try:
            saved = ACTIVE_PATH.read_text(encoding="utf-8").strip()
            if saved in self._items:
                return saved
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning(f"personalities: could not read active file: {e}")
        # default if present, else first loaded, else the default id
        if DEFAULT_ID in self._items:
            return DEFAULT_ID
        return next(iter(self._items), DEFAULT_ID)

    def _persist_active(self) -> None:
        try:
            ACTIVE_PATH.parent.mkdir(parents=True, exist_ok=True)
            ACTIVE_PATH.write_text(self._active, encoding="utf-8")
        except Exception as e:
            logger.warning(f"personalities: could not persist active: {e}")

    # ── access ──────────────────────────────────────────────────────

    def get(self, pid: str) -> dict | None:
        return self._items.get(pid)

    def active_id(self) -> str:
        return self._active if self._active in self._items else DEFAULT_ID

    def active(self) -> dict | None:
        return self.get(self.active_id())

    def set_active(self, pid: str) -> dict | None:
        """Switch the active personality. Returns the new personality
        dict, or None if the id is unknown."""
        if pid not in self._items:
            return None
        self._active = pid
        self._persist_active()
        logger.info(f"personalities: active -> {pid}")
        return self._items[pid]

    def list_public(self) -> list[dict]:
        """Personalities without the prompt body — for the tray + the
        client's switch matcher."""
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "voice": p.get("voice", ""),
                "default_emotion": p.get("default_emotion", "relaxed"),
            }
            for p in self._items.values()
        ]

    def match(self, text: str) -> dict | None:
        """Detect a 'switch to X' style command. Requires a switch verb
        AND a known personality name/id so normal chat never triggers an
        accidental switch. Returns the matched personality or None."""
        t = (text or "").lower()
        if not any(
            v in t
            for v in ("switch", "change", "become", "be the", "act like",
                      "personality", "turn into", "go ", "mode")
        ):
            return None
        for p in self._items.values():
            name = p["name"].lower()
            pid = p["id"].lower().replace("_", " ")
            if name in t or pid in t:
                return p
        return None


store = PersonalityStore()
