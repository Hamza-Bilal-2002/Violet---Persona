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


# ---- config -----------------------------------------------------------------

VOICE_NAME = "en_US-hfc_female-medium"
VOICE_DIR = Path("/models")
VOICE_MODEL_PATH = VOICE_DIR / f"{VOICE_NAME}.onnx"
VOICE_CONFIG_PATH = VOICE_DIR / f"{VOICE_NAME}.onnx.json"


# ---- app --------------------------------------------------------------------

app = FastAPI(title="Persona TTS Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- model (lazy) -----------------------------------------------------------

_voice = None


def get_voice():
    """Lazy-load the PiperVoice singleton on first synth."""

    global _voice

    if _voice is None:

        from piper import PiperVoice

        logger.info(
            f"loading piper voice: {VOICE_NAME} "
            f"(model={VOICE_MODEL_PATH}, config={VOICE_CONFIG_PATH})"
        )

        _voice = PiperVoice.load(
            str(VOICE_MODEL_PATH),
            config_path=str(VOICE_CONFIG_PATH),
        )

        logger.info("piper voice ready")

    return _voice


# ---- schemas ----------------------------------------------------------------


class SynthesizeRequest(BaseModel):
    text: str


# ---- routes -----------------------------------------------------------------


@app.get("/")
async def root():
    return {
        "name": "persona-tts",
        "version": "0.1.0",
        "voice": VOICE_NAME,
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "voice": VOICE_NAME,
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

    voice = get_voice()

    # PiperVoice.synthesize writes a complete RIFF/WAV file into a
    # wave.Wave_write opened on a file-like object. Buffering into
    # BytesIO is fine — utterances are short.

    wav_io = io.BytesIO()

    with wave.open(wav_io, "wb") as wav_file:

        voice.synthesize(text, wav_file)

    wav_bytes = wav_io.getvalue()

    logger.info(
        f"synthesize: {len(wav_bytes)} bytes for {len(text)} chars"
    )

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
    )
