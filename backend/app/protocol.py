"""
Parses inline <emotion .../> and <animation>...</animation> tags
out of the LLM's raw text response and returns a structured reply
along with the cleaned text the avatar should actually speak.

The LLM is prompted to place ONE emotion tag and ONE animation
tag per reply (see llm.py SYSTEM_PROMPT). If multiple appear,
we take the LAST occurrence of each — closer to the final tone.

The strict regexes match the spec'd syntax exactly. Loose
fallback regexes catch common model deviations — <animation=name>,
<animation:name>, <animation name>, [animation=name] — so a
slipped tag doesn't leak into TTS or fall back to defaults.
Whatever the loose pass matches is ALSO stripped from the
cleaned text so the avatar doesn't speak the markup.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


VALID_EMOTIONS = {"happy", "sad", "angry", "surprised", "relaxed"}
VALID_ANIMATIONS = {"idle", "talking", "thinking", "happy", "waving", "reacting"}

DEFAULT_EMOTION_NAME = "relaxed"
DEFAULT_EMOTION_INTENSITY = 0.4
DEFAULT_ANIMATION = "talking"

# Strict syntax — what we ask the model to produce.

EMOTION_TAG = re.compile(
    r"""<emotion\s+name=["'](?P<name>[a-zA-Z]+)["']\s+intensity=["'](?P<intensity>[0-9.]+)["']\s*/?>""",
    re.IGNORECASE,
)

ANIMATION_TAG = re.compile(
    r"""<animation>\s*(?P<name>[a-zA-Z]+)\s*</animation>""",
    re.IGNORECASE,
)

# Loose fallbacks — recover from common model improvisations.
# Matched ONLY if the strict pattern didn't find anything. Catches:
#   <animation=thinking>      <animation:thinking>
#   <animation thinking>      <animation thinking/>
#   [animation=thinking]      <emotion=happy intensity=0.4>
#   <emotion happy 0.4>

ANIMATION_TAG_LOOSE = re.compile(
    r"""[<\[]animation[\s=:]+(?P<name>[a-zA-Z]+)[\s/]*[>\]]""",
    re.IGNORECASE,
)

EMOTION_TAG_LOOSE = re.compile(
    r"""[<\[]emotion[\s=:]+(?P<name>[a-zA-Z]+)(?:[\s,=:]+intensity[\s=:]+|[\s,]+)?(?P<intensity>[0-9.]+)?[\s/]*[>\]]""",
    re.IGNORECASE,
)


@dataclass
class ParsedReply:
    text: str
    emotion_name: str
    emotion_intensity: float
    animation: str

    def to_dict(self) -> dict:
        return {
            "type": "reply",
            "text": self.text,
            "emotion": {
                "name": self.emotion_name,
                "intensity": self.emotion_intensity,
            },
            "animation": self.animation,
        }


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def parse_reply(raw: str) -> ParsedReply:
    """Strip emotion/animation tags from raw, return structured reply."""

    emotion_name = DEFAULT_EMOTION_NAME
    emotion_intensity = DEFAULT_EMOTION_INTENSITY
    animation = DEFAULT_ANIMATION

    # ---- emotion -----------------------------------------------------------

    emotion_matches = list(EMOTION_TAG.finditer(raw))
    used_loose_emotion = False
    if not emotion_matches:
        emotion_matches = list(EMOTION_TAG_LOOSE.finditer(raw))
        used_loose_emotion = bool(emotion_matches)

    if emotion_matches:
        last = emotion_matches[-1]
        name = last.group("name").lower()
        intensity_str = last.groupdict().get("intensity") or ""
        try:
            intensity = float(intensity_str) if intensity_str else DEFAULT_EMOTION_INTENSITY
        except ValueError:
            intensity = DEFAULT_EMOTION_INTENSITY
        if name in VALID_EMOTIONS:
            emotion_name = name
            emotion_intensity = _clamp(intensity, 0.0, 1.0)

    # ---- animation ---------------------------------------------------------

    animation_matches = list(ANIMATION_TAG.finditer(raw))
    used_loose_animation = False
    if not animation_matches:
        animation_matches = list(ANIMATION_TAG_LOOSE.finditer(raw))
        used_loose_animation = bool(animation_matches)

    if animation_matches:
        last = animation_matches[-1]
        name = last.group("name").lower()
        if name in VALID_ANIMATIONS:
            animation = name

    # ---- clean text --------------------------------------------------------
    #
    # Always strip BOTH strict and loose patterns regardless of which one
    # populated state, so a loose-format tag never makes it into TTS.

    cleaned = EMOTION_TAG.sub("", raw)
    cleaned = ANIMATION_TAG.sub("", cleaned)
    cleaned = EMOTION_TAG_LOOSE.sub("", cleaned)
    cleaned = ANIMATION_TAG_LOOSE.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if used_loose_emotion or used_loose_animation:
        # Worth knowing — the model deviated from the spec. Surface
        # it so we can iterate on the system prompt if it persists.
        from loguru import logger
        logger.warning(
            f"parse_reply: recovered from loose tag format "
            f"(emotion={used_loose_emotion}, animation={used_loose_animation})"
        )

    return ParsedReply(
        text=cleaned,
        emotion_name=emotion_name,
        emotion_intensity=emotion_intensity,
        animation=animation,
    )
