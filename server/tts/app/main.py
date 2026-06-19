"""
Text-to-speech service (Phase 4 Wave 4.2).

POST /synthesize accepts {"text": "..."} and returns a WAV file
synthesized by Piper. The renderer plays it through an
HTMLAudioElement and the existing LipSyncManager.attachAudio()
path handles lip-sync via Web Audio AnalyserNode — no visemes
shipped from the backend (see memory: lipsync_frontend_only).

Piper is an ONNX-based neural TTS that runs comfortably on CPU.
The voice model lives at /models (pre-downloaded at build time)
and is lazy-loaded on the first request so uvicorn --reload
doesn't load it twice and process startup stays cheap.
"""

from __future__ import annotations

import io
import wave
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from pydantic import BaseModel

from .normalize import normalize_for_speech


# ---- config -----------------------------------------------------------------

# Default voice when none is requested or the requested one isn't
# installed. Personalities pick a voice per their config (see
# server/config/personalities/*.json); whichever voices they name must
# be baked into the image (see the Dockerfile).
DEFAULT_VOICE = "en_US-hfc_female-medium"
VOICE_DIR = Path("/models")


# ---- app --------------------------------------------------------------------

app = FastAPI(title="Persona TTS Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- models (lazy, per voice) -----------------------------------------------

# Loaded PiperVoice instances keyed by voice name. Each voice is loaded
# once on first use and cached — switching personalities mid-session
# costs one load the first time that voice is heard, nothing after.
_voices: dict = {}


def _installed_voices() -> list[str]:
    return sorted(p.stem for p in VOICE_DIR.glob("*.onnx"))


def get_voice(name: str | None):
    """Lazy-load and cache the PiperVoice for `name`, falling back to
    DEFAULT_VOICE when the requested voice isn't installed."""

    name = (name or DEFAULT_VOICE).strip()
    model_path = VOICE_DIR / f"{name}.onnx"

    if not model_path.exists():
        if name != DEFAULT_VOICE:
            logger.warning(f"voice '{name}' not installed — using default")
        name = DEFAULT_VOICE
        model_path = VOICE_DIR / f"{name}.onnx"

    if name not in _voices:
        from piper import PiperVoice

        logger.info(f"loading piper voice: {name}")
        _voices[name] = PiperVoice.load(
            str(model_path),
            config_path=f"{model_path}.json",
        )
        logger.info(f"piper voice ready: {name}")

    return _voices[name]


# ---- schemas ----------------------------------------------------------------


class SynthesizeRequest(BaseModel):
    text: str
    # Optional voice name (e.g. "en_US-amy-medium"). Falls back to the
    # default when omitted or unknown.
    voice: str | None = None


# ---- routes -----------------------------------------------------------------


@app.get("/")
async def root():
    return {
        "name": "persona-tts",
        "version": "0.1.0",
        "default_voice": DEFAULT_VOICE,
        "voices": _installed_voices(),
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "default_voice": DEFAULT_VOICE,
        "voices": _installed_voices(),
    }


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    """Generate WAV audio for the given text.

    Returns a single audio/wav response. The whole utterance is
    rendered in one shot — for short conversational replies this
    is faster than streaming and the renderer's lip-sync pipeline
    is much simpler when it has the full Audio element up front.
    """

    text = (req.text or "").strip()

    if not text:
        logger.warning("synthesize: empty text")
        return Response(status_code=400)

    # Rewrite TTS-hostile tokens ("hmph" -> "hmf", "i's" -> "eyes") into
    # phonetic-friendly spellings before the model sees them. This only
    # affects the spoken audio — the renderer shows the original text
    # untouched. Engine-independent, so it survives a future Kokoro swap.
    spoken = normalize_for_speech(text)
    if spoken != text:
        logger.info(f"normalized for speech: {text!r} -> {spoken!r}")

    voice = get_voice(req.voice)

    # PiperVoice.synthesize writes a complete RIFF/WAV file into a
    # wave.Wave_write opened on a file-like object. Buffering into
    # BytesIO is fine — utterances are short.

    wav_io = io.BytesIO()

    with wave.open(wav_io, "wb") as wav_file:

        voice.synthesize(spoken, wav_file)

    wav_bytes = wav_io.getvalue()

    logger.info(
        f"synthesize: {len(wav_bytes)} bytes for {len(text)} chars"
    )

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
    )
