"""
Speech-to-text service.

Single endpoint, /transcribe, that accepts a WebM/Opus blob from the
renderer's MediaRecorder and returns the transcript. Backed by
faster-whisper (CTranslate2 build of OpenAI Whisper). Model is the
"tiny" int8 CPU variant — small enough to run anywhere, fast enough
to feel conversational for short utterances.

The model is lazy-loaded on the first request rather than at import
so that:
  - uvicorn --reload doesn't load it twice
  - process startup stays cheap
  - the build-time `python -c "WhisperModel('tiny', ...)"` step is
    only there to populate the on-disk cache, not to keep a model
    pinned in memory

To swap the model, change MODEL_SIZE below (e.g., "base", "small").
Bigger models = better accuracy + more memory + slower transcription.
See https://github.com/SYSTRAN/faster-whisper for the size matrix.
"""

from __future__ import annotations

import tempfile

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger


# ---- config -----------------------------------------------------------------

MODEL_SIZE = "tiny"
MODEL_DEVICE = "cpu"
MODEL_COMPUTE_TYPE = "int8"
MODEL_LANGUAGE = "en"
BEAM_SIZE = 3


# ---- app --------------------------------------------------------------------

app = FastAPI(title="Persona Speech Service", version="0.1.0")

# Local-only dev: CORS is wide open. The renderer runs at
# http://localhost:5173 (Vite) or file:// (packaged Electron); both
# need to hit this from a browser context.

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- model (lazy) -----------------------------------------------------------

_model = None


def get_model():
    """Lazy-load the WhisperModel singleton on first use."""

    global _model

    if _model is None:

        from faster_whisper import WhisperModel

        logger.info(
            f"loading whisper model: size={MODEL_SIZE} "
            f"device={MODEL_DEVICE} compute_type={MODEL_COMPUTE_TYPE}"
        )

        _model = WhisperModel(
            MODEL_SIZE,
            device=MODEL_DEVICE,
            compute_type=MODEL_COMPUTE_TYPE,
        )

        logger.info("whisper model ready")

    return _model


# ---- routes -----------------------------------------------------------------

@app.get("/")
async def root():
    return {"name": "persona-speech", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_SIZE}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Accept an audio file (WebM/Opus from MediaRecorder by default),
    transcribe it with Whisper, return {"text": "..."}.

    VAD filter is on so brief silences and non-speech segments don't
    confuse the decoder. Language is pinned to English for Wave 1.
    """

    payload = await audio.read()

    if not payload:
        logger.warning("transcribe: empty upload")
        return {"text": ""}

    # NamedTemporaryFile + delete=False because faster-whisper opens
    # the path itself; we manage the file lifecycle so it stays valid
    # for the duration of transcription. Suffix preserves the codec
    # hint for ffmpeg / libsndfile.

    with tempfile.NamedTemporaryFile(
        suffix=".webm",
        delete=False,
    ) as tmp:

        tmp.write(payload)
        tmp_path = tmp.name

    try:

        model = get_model()

        segments, info = model.transcribe(
            tmp_path,
            language=MODEL_LANGUAGE,
            beam_size=BEAM_SIZE,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=300),
        )

        # `segments` is a generator. Force evaluation here, joining the
        # text fields with single spaces. Whisper already includes
        # leading whitespace on each segment so we strip() at the end
        # to keep output tidy.

        text = "".join(segment.text for segment in segments).strip()

        if not text:
            logger.warning(
                f"transcribe: empty (lang={info.language}, "
                f"prob={info.language_probability:.2f})"
            )
        else:
            logger.info(f"transcribe: {text!r}")

        return {"text": text}

    except Exception as e:

        logger.exception("transcribe failed")
        return {"text": "", "error": str(e)}

    finally:

        # Clean up the temp file. Best-effort: if it's already gone,
        # don't crash the request.

        import os
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
