"""
Speech text normalization (pre-TTS).

Piper — and most neural TTS — doesn't read text directly. It runs the
text through a grapheme->phoneme engine (espeak-ng for Piper) and the
model renders the resulting phonemes. That engine has two blind spots
that show up constantly in conversational replies:

  1. Tokens it can't pronounce (no vowel / not in its lexicon) get
     SPELLED OUT letter by letter: "hmph" -> "h m p h", "pfft" -> "p f f t".
  2. Letter-name constructs it has no rule for: "i's" -> "iss" (short
     vowel) instead of "eyes" (/aɪz/).

This module rewrites the SPOKEN copy of the text just before synthesis,
mapping TTS-hostile tokens to phonetic-friendly spellings. It never
touches what the renderer shows on screen — only the bytes handed to
the model — so "what's with the extra i's?" still reads correctly in the
UI while being voiced as "...extra eyes?".

Deliberately engine-independent: it operates on text, so it keeps
helping if we swap Piper for Kokoro or anything else later. The
interjection set is open-ended; seed it with the common cases and grow
the dict as new ones surface.
"""

from __future__ import annotations

import re


# Whole-word replacements. Keys are matched case-insensitively as whole
# words (see _WORD_RE); the replacement is substituted verbatim. Order
# doesn't matter — each word is looked up independently.
#
# The goal of each value is not "correct spelling" but "spelling that
# espeak phonemizes into the sound a person makes." Tune by ear.
_WORD_MAP: dict[str, str] = {
    # ── Interjections / non-lexical vocalizations ──────────────────────
    # These have no vowels or aren't in the dictionary, so espeak spells
    # them out. Give it something it can sound out.
    "hmph":  "hmf",
    "hmf":   "hmf",
    "hmm":   "hmm",
    "hmmm":  "hmmm",
    "mhm":   "mm-hmm",
    "mmhmm": "mm-hmm",
    "mm":    "mmm",
    "ugh":   "uhh",
    "ughh":  "uhh",
    "tsk":   "tisk",
    "pfft":  "fft",
    "pft":   "fft",
    "psh":   "pshh",
    "pssh":  "pshh",
    "grr":   "grr",
    "grrr":  "grrr",
    "argh":  "argh",
    " argh": "argh",
    "blegh": "blehh",
    "bleh":  "blehh",
    "meh":   "mehh",
    "eh":    "ehh",
    "ew":    "eww",
    "eww":   "eww",
    "oof":   "oof",
    "phew":  "few",
    "tch":   "tch",
    "shh":   "shh",
    "sigh":  "sigh",
    "huh":   "huh",
    "duh":   "duh",
    "yikes": "yikes",
    "oop":   "oop",
    "oops":  "oops",
    "whoa":  "woah",
    "aw":    "aww",
    "aww":   "aww",
    "ow":    "ow",
    "ouch":  "ouch",
    "hah":   "hah",
    "heh":   "heh",
    "hehe":  "heh heh",
    "haha":  "ha ha",
    "hahaha": "ha ha ha",
    "lol":   "ha ha",
    "yay":   "yay",
    "yup":   "yup",
    "yep":   "yep",
    "nope":  "nope",
    "nah":   "nah",
    "uh":    "uhh",
    "um":    "umm",
    "er":    "errr",
    "hmk":   "mkay",
    "mkay":  "mkay",
    "kay":   "kay",

    # ── Letter-name constructs espeak mis-voices ───────────────────────
    # "i's" is the big one from real usage; cover the other single-letter
    # plurals/possessives that read as words.
    "i's":   "eyes",
    "u's":   "yous",
    "y's":   "whys",
    "a's":   "ayes",

    # ── Common abbreviations that read as letters or wrong words ───────
    "dr":    "doctor",
    "dr.":   "doctor",
    "mr":    "mister",
    "mr.":   "mister",
    "mrs":   "missus",
    "mrs.":  "missus",
    "ms":    "miss",
    "vs":    "versus",
    "vs.":   "versus",
    "etc":   "etcetera",
    "etc.":  "etcetera",
    "approx": "approximately",
    "aka":   "a-k-a",
    "asap":  "a-s-a-p",
}

# Whole-word matcher. \b won't work for keys containing "'" or "." the way
# we want, so build an explicit alternation sorted longest-first (so "dr."
# wins over "dr"). Word boundaries are approximated with lookaround on
# alphanumerics to avoid matching inside larger words.
_SORTED_KEYS = sorted(_WORD_MAP.keys(), key=len, reverse=True)
_WORD_RE = re.compile(
    r"(?<![A-Za-z0-9])(" + "|".join(re.escape(k) for k in _SORTED_KEYS) + r")(?![A-Za-z0-9])",
    re.IGNORECASE,
)


def _replace_word(match: re.Match) -> str:
    return _WORD_MAP[match.group(0).lower()]


# Standalone "%" -> "percent" when attached to a number ("50%" -> "50 percent").
_PERCENT_RE = re.compile(r"(\d)\s*%")

# Collapse a run of the same letter 4+ long down to 3 ("soooo" -> "sooo"),
# which espeak handles far better than a 7-long run. Keeps emphasis without
# the engine choking. Applies to vowels where elongation is intentional.
_ELONGATED_RE = re.compile(r"([aeiouAEIOU])\1{3,}")


def normalize_for_speech(text: str) -> str:
    """Rewrite TTS-hostile tokens in `text` into phonetic-friendly forms.

    Pure function: returns a new string, leaves the input untouched. Safe
    to call on every utterance — it's a handful of regex passes over a
    short reply, negligible cost next to the neural synthesis that follows.
    """

    if not text:
        return text

    out = _PERCENT_RE.sub(r"\1 percent", text)
    out = _ELONGATED_RE.sub(lambda m: m.group(1) * 3, out)
    out = _WORD_RE.sub(_replace_word, out)

    return out
