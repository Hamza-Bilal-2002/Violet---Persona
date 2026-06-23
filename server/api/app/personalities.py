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
import re
from pathlib import Path

from loguru import logger


DEFAULT_ID = "angry_gf"

_DIR_CANDIDATES = [
    Path("/app/config/personalities"),
    Path(__file__).resolve().parent.parent.parent / "config" / "personalities",
]

# User-created / user-edited personalities live OUTSIDE the read-only baked
# config dir, in a writable /data overlay so they survive image rebuilds.
# Loaded AFTER the baked set so a user file overrides a baked one by id;
# deleting a user override reverts to the baked version.
USER_DIR = Path(
    os.environ.get("PERSONA_USER_PERSONALITIES_DIR", "/data/personalities")
)

# Voices the TTS service can speak (Piper models baked into server/tts —
# see its Dockerfile). Surfaced to the editor UI so a new personality picks
# from real, installed voices rather than a free-text guess.
KNOWN_VOICES = [
    "en_US-hfc_female-medium",
    "en_US-amy-medium",
    "en_US-lessac-medium",
    "en_GB-jenny_dioco-medium",
]
KNOWN_EMOTIONS = ["happy", "sad", "angry", "surprised", "relaxed"]


def _slugify(text: str) -> str:
    """A safe, file-name-friendly id from a display name."""
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return s or "personality"

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
        # ids that come from the read-only baked config dir. A user override
        # in /data with the same id keeps the id in this set (so we know it
        # can be "reverted" rather than fully deleted).
        self._builtin_ids: set[str] = set()
        self._load()
        self._active = self._load_active()
        self._adult = self._load_adult()

    # ── loading ─────────────────────────────────────────────────────

    @staticmethod
    def _coerce(data: dict, fallback_id: str) -> dict | None:
        """Normalise a raw personality dict, filling defaults. Returns None
        if it has no usable id."""
        pid = (data.get("id") or fallback_id or "").strip()
        if not pid:
            return None
        data["id"] = pid
        data.setdefault("name", pid.replace("_", " ").title())
        data.setdefault("voice", "")
        data.setdefault("default_emotion", "relaxed")
        data.setdefault("prompt", "")
        return data

    def _load(self) -> None:
        """(Re)load the roster: baked config dir first, then the writable
        /data user overlay (which overrides baked entries by id)."""
        self._items = {}
        self._builtin_ids = set()

        d = _personalities_dir()
        if d:
            for path in sorted(d.glob("*.json")):
                try:
                    item = self._coerce(
                        json.loads(path.read_text(encoding="utf-8")), path.stem
                    )
                    if item:
                        self._items[item["id"]] = item
                        self._builtin_ids.add(item["id"])
                except Exception as e:
                    logger.warning(f"personalities: failed to load {path.name}: {e}")
        else:
            logger.warning("personalities: no baked config dir found")

        if USER_DIR.is_dir():
            for path in sorted(USER_DIR.glob("*.json")):
                try:
                    item = self._coerce(
                        json.loads(path.read_text(encoding="utf-8")), path.stem
                    )
                    if item:
                        self._items[item["id"]] = item  # overrides baked
                except Exception as e:
                    logger.warning(
                        f"personalities: failed to load user {path.name}: {e}"
                    )

        logger.info(
            f"personalities: loaded {len(self._items)} "
            f"({', '.join(self._items)})"
        )

    # ── user overlay (writable) CRUD ─────────────────────────────────

    @staticmethod
    def _user_file(pid: str) -> Path:
        return USER_DIR / f"{pid}.json"

    def _unique_id(self, base: str) -> str:
        """A slug not already taken (for newly created personalities)."""
        pid = _slugify(base)
        if pid not in self._items:
            return pid
        n = 2
        while f"{pid}_{n}" in self._items:
            n += 1
        return f"{pid}_{n}"

    def save(self, data: dict) -> dict | None:
        """Create or update a personality in the writable overlay. When
        `id` is present it edits that one (a baked id becomes an override);
        otherwise a new id is minted from the name. Returns the saved item,
        or None if name/prompt are empty."""
        name = (data.get("name") or "").strip()
        prompt = (data.get("prompt") or "").strip()
        if not name or not prompt:
            return None

        pid = (data.get("id") or "").strip()
        if not pid:
            pid = self._unique_id(name)

        item = {
            "id": pid,
            "name": name,
            "prompt": prompt,
            "voice": (data.get("voice") or "").strip(),
            "default_emotion": (data.get("default_emotion") or "relaxed").strip(),
        }
        try:
            USER_DIR.mkdir(parents=True, exist_ok=True)
            self._user_file(pid).write_text(
                json.dumps(item, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"personalities: could not save {pid}: {e}")
            return None

        self._load()
        logger.info(f"personalities: saved {pid}")
        return self._items.get(pid)

    def delete(self, pid: str) -> tuple[bool, str]:
        """Remove a user overlay file. For a baked id this reverts to the
        baked version; for a purely user-created one it's gone. Returns
        (ok, message). A baked id with no override can't be deleted."""
        f = self._user_file(pid)
        if not f.exists():
            if pid in self._builtin_ids:
                return (False, "built-in personalities can't be deleted, only edited")
            return (False, "unknown personality")
        try:
            f.unlink()
        except Exception as e:
            return (False, str(e))

        self._load()
        # If we just deleted the active personality (and it didn't revert to
        # a baked one), fall back to the default.
        if self._active not in self._items:
            self._active = self._load_active()
            self._persist_active()
        reverted = pid in self._items
        logger.info(f"personalities: deleted {pid} (reverted={reverted})")
        return (True, "reverted to built-in" if reverted else "deleted")

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

    def _deletable(self, pid: str) -> bool:
        """A personality can be removed/reverted when a user overlay file
        exists for it (pure-user ones vanish; baked overrides revert)."""
        return self._user_file(pid).exists()

    def list_full(self) -> list[dict]:
        """Full personalities (incl. prompt + edit metadata) for the editor
        UI. Carries `builtin` (has a baked source) and `deletable` flags."""
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "prompt": p.get("prompt", ""),
                "voice": p.get("voice", ""),
                "default_emotion": p.get("default_emotion", "relaxed"),
                "builtin": p["id"] in self._builtin_ids,
                "deletable": self._deletable(p["id"]),
            }
            for p in self._items.values()
        ]

    def options(self) -> dict:
        """Choices the editor offers (voices, emotions)."""
        return {"voices": KNOWN_VOICES, "emotions": KNOWN_EMOTIONS}

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
