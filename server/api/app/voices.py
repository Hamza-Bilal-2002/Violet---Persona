"""
Voice catalog — friendly labels for the Piper voices baked into the TTS
service (server/tts/Dockerfile). The TTS service is the source of truth for
which voices are actually *installed*; this just maps those ids to display
names + metadata for the Settings voice picker and the personality editor.

To add a voice: bake it in server/tts/Dockerfile, then add a label here.
Anything installed but unlabelled still shows up with a prettified id.
"""

from __future__ import annotations

# id -> (label, locale, gender)
VOICE_LABELS: dict[str, tuple[str, str, str]] = {
    "en_US-hfc_female-medium":            ("Violet — default (US)", "en_US", "female"),
    "en_US-amy-medium":                   ("Amy (US)",              "en_US", "female"),
    "en_US-lessac-medium":                ("Lessac (US)",           "en_US", "female"),
    "en_US-kristin-medium":               ("Kristin (US)",          "en_US", "female"),
    "en_US-kathleen-low":                 ("Kathleen (US)",         "en_US", "female"),
    "en_US-ljspeech-high":                ("LJ (US)",               "en_US", "female"),
    "en_GB-jenny_dioco-medium":           ("Jenny (UK)",            "en_GB", "female"),
    "en_GB-alba-medium":                  ("Alba (UK)",             "en_GB", "female"),
    "en_GB-southern_english_female-low":  ("Southern English (UK)", "en_GB", "female"),
    "en_US-hfc_male-medium":              ("HFC (US, male)",        "en_US", "male"),
    "en_US-ryan-high":                    ("Ryan (US, male)",       "en_US", "male"),
    "en_GB-alan-medium":                  ("Alan (UK, male)",       "en_GB", "male"),
}


def _prettify(voice_id: str) -> str:
    """Best-effort display name for a voice id with no explicit label."""
    core = voice_id.split("-")[1] if "-" in voice_id else voice_id
    return core.replace("_", " ").title()


def describe(voice_id: str) -> dict:
    """One catalog entry for a voice id (labelled or prettified)."""
    label, locale, gender = VOICE_LABELS.get(voice_id, (None, "", ""))
    return {
        "id": voice_id,
        "label": label or _prettify(voice_id),
        "locale": locale,
        "gender": gender,
    }


def catalog(installed: list[str] | None = None) -> list[dict]:
    """Catalog entries. When `installed` is given, returns exactly those
    (so the picker only offers real voices); otherwise the full labelled
    set as a fallback when the TTS service can't be reached."""
    ids = installed if installed is not None else list(VOICE_LABELS)
    return [describe(v) for v in ids]
