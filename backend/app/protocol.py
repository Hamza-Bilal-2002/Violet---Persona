"""
Parses inline <emotion .../> and <animation>...</animation> tags
out of the LLM's raw text response and returns a structured reply
along with the cleaned text the avatar should actually speak.

The LLM is prompted to place ONE emotion tag and ONE animation
tag per reply (see llm.py SYSTEM_PROMPT). If multiple appear,
we take the LAST occurrence of each — closer to the final tone.
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

EMOTION_TAG = re.compile(
    r"""<emotion\s+name=["'](?P<name>[a-zA-Z]+)["']\s+intensity=["'](?P<intensity>[0-9.]+)["']\s*/?>""",
    re.IGNORECASE,
)

ANIMATION_TAG = re.compile(
    r"""<animation>\s*(?P<name>[a-zA-Z]+)\s*</animation>""",
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

    emotion_matches = list(EMOTION_TAG.finditer(raw))
    if emotion_matches:
        last = emotion_matches[-1]
        name = last.group("name").lower()
        try:
            intensity = float(last.group("intensity"))
        except ValueError:
            intensity = DEFAULT_EMOTION_INTENSITY
        if name in VALID_EMOTIONS:
            emotion_name = name
            emotion_intensity = _clamp(intensity, 0.0, 1.0)

    animation_matches = list(ANIMATION_TAG.finditer(raw))
    if animation_matches:
        last = animation_matches[-1]
        name = last.group("name").lower()
        if name in VALID_ANIMATIONS:
            animation = name

    cleaned = EMOTION_TAG.sub("", raw)
    cleaned = ANIMATION_TAG.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    return ParsedReply(
        text=cleaned,
        emotion_name=emotion_name,
        emotion_intensity=emotion_intensity,
        animation=animation,
    )
