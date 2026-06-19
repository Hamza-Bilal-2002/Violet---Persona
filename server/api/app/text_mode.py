"""
Text-mode (text roleplay) scene + rules store.

Text mode is a muted, text-to-text roleplay mode. Unlike the personalities
(which are fixed configs) its two knobs — the SCENE setting and the
ROLEPLAY RULES — are user-editable at runtime from the chat UI. Per Hamza's
choice these live in a backend config file, so edits are made server-side
and persist across restarts.

Layout mirrors personalities/active state:
  - committed defaults at server/config/text_mode.json (read-only baseline)
  - a writable overlay at /data/text_mode.json (the user's edits)

get() returns the effective {scene, rules}; update() writes the overlay.
Only scene + rules are user-editable — id/name stay from the default file.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from loguru import logger


_DEFAULT_CANDIDATES = [
    Path("/app/config/text_mode.json"),
    Path(__file__).resolve().parent.parent.parent / "config" / "text_mode.json",
]

# Writable overlay holding the user's edited scene/rules. Lives in the same
# /data volume as memory + active personality so it survives restarts.
OVERLAY_PATH = Path(
    os.environ.get("PERSONA_TEXT_MODE_PATH", "/data/text_mode.json")
)


class TextModeStore:

    def __init__(self) -> None:
        self._default = self._load_default()
        self._overlay = self._load_overlay()

    def _load_default(self) -> dict:
        for path in _DEFAULT_CANDIDATES:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                logger.info("text_mode: defaults loaded")
                return data
            except FileNotFoundError:
                continue
            except Exception as e:
                logger.warning(f"text_mode: failed to load defaults: {e}")
                break
        logger.info("text_mode: no defaults file; using built-in blanks")
        return {"id": "text_rp", "name": "Text Mode", "scene": "", "rules": ""}

    def _load_overlay(self) -> dict:
        try:
            return json.loads(OVERLAY_PATH.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except Exception as e:
            logger.warning(f"text_mode: could not read overlay: {e}")
            return {}

    def _persist_overlay(self) -> None:
        try:
            OVERLAY_PATH.parent.mkdir(parents=True, exist_ok=True)
            OVERLAY_PATH.write_text(
                json.dumps(self._overlay, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"text_mode: could not persist overlay: {e}")

    def get(self) -> dict:
        """Effective config: defaults with the user's overlay applied."""
        scene = self._overlay.get("scene", self._default.get("scene", ""))
        rules = self._overlay.get("rules", self._default.get("rules", ""))
        return {
            "id": self._default.get("id", "text_rp"),
            "name": self._default.get("name", "Text Mode"),
            "scene": scene or "",
            "rules": rules or "",
        }

    def update(self, scene: str | None = None, rules: str | None = None) -> dict:
        """Persist edited scene and/or rules. Passing None leaves that field
        untouched. Returns the new effective config."""
        if scene is not None:
            self._overlay["scene"] = scene
        if rules is not None:
            self._overlay["rules"] = rules
        self._persist_overlay()
        logger.info("text_mode: scene/rules updated")
        return self.get()


store = TextModeStore()
