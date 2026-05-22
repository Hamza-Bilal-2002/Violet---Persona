"""
Wake-word service.

A single WebSocket endpoint, /ws, that accepts a continuous stream
of 16 kHz mono Int16 PCM chunks from the renderer and emits
JSON detection events whenever the wake-word model scores above
DETECTION_THRESHOLD.

We use openwakeword as the engine — open source, ONNX-runtime
backed, no third-party service needed. Picovoice Porcupine would
have been the obvious choice but their personal-account access was
removed in late 2024, so openwakeword is the practical alternative.

For Wave 1 we ship the bundled "hey_jarvis" model. Training a custom
"Violet" keyword is a documented follow-up (recordings + Colab run).

Chunk math:
  openwakeword expects 1280 samples per inference at 16 kHz = 80 ms.
  The renderer's AudioWorklet emits exactly that size.
"""

from __future__ import annotations

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger


# ---- config -----------------------------------------------------------------

WAKE_MODELS = ["hey_jarvis"]
DETECTION_THRESHOLD = 0.5
INFERENCE_FRAMEWORK = "onnx"


# ---- app --------------------------------------------------------------------

app = FastAPI(title="Persona Wake Service", version="0.1.0")

# Local-only: renderer connects from http://localhost:5173 (Vite) or
# file:// (packaged Electron). Wide-open CORS is fine here — nothing
# on the public internet should ever reach this port.

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
    """Lazy-load the openwakeword Model singleton on first connect."""

    global _model

    if _model is None:

        from openwakeword.model import Model

        logger.info(
            f"loading wake models: {WAKE_MODELS} "
            f"(framework={INFERENCE_FRAMEWORK})"
        )

        _model = Model(
            wakeword_models=WAKE_MODELS,
            inference_framework=INFERENCE_FRAMEWORK,
        )

        logger.info("wake model ready")

    return _model


# ---- routes -----------------------------------------------------------------

@app.get("/")
async def root():
    return {"name": "persona-wake", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models": WAKE_MODELS,
        "threshold": DETECTION_THRESHOLD,
    }


@app.websocket("/ws")
async def wake_ws(websocket: WebSocket):
    """
    Continuous PCM stream in, detection JSON out.

    Each inbound binary message is one openwakeword frame: 1280 Int16
    samples (2560 bytes) at 16 kHz mono. We run predict() on each
    frame; if any model scores above threshold we emit a JSON event
    and reset the model so we don't re-fire on the same utterance.

    Text messages are tolerated for liveness/ping but ignored.
    """

    await websocket.accept()

    model = get_model()

    logger.info("wake client connected")

    # Diagnostics: periodically log frames-received + max score seen
    # in the batch even when nothing crossed the threshold. Helps
    # disambiguate "no audio arriving" from "audio arriving but model
    # is scoring near zero" (e.g. wrong sample rate).

    batch_frames = 0
    batch_max_score = 0.0
    DIAGNOSTIC_BATCH = 50  # 50 frames * 80 ms = 4 s

    try:

        while True:

            msg = await websocket.receive()

            if msg.get("type") == "websocket.disconnect":

                break

            payload = msg.get("bytes")

            if payload is None:

                # Text frames (ping/heartbeat) are tolerated but
                # not used. Keeping a no-op branch so the loop
                # doesn't crash on unexpected text traffic.

                continue

            # Int16 little-endian — what the renderer's AudioWorklet
            # emits. Buffer length should be 2560 bytes (1280 samples)
            # but we don't enforce strictly; openwakeword tolerates
            # short frames (returns 0 scores) and we run predict per
            # message either way.

            audio = np.frombuffer(payload, dtype=np.int16)

            scores = model.predict(audio)

            # Track the highest score seen this batch for diagnostics.

            for _keyword, score in scores.items():

                if score > batch_max_score:
                    batch_max_score = score

            batch_frames += 1

            if batch_frames >= DIAGNOSTIC_BATCH:

                logger.info(
                    f"wake heartbeat: frames={batch_frames} "
                    f"max_score={batch_max_score:.4f} "
                    f"(threshold={DETECTION_THRESHOLD})"
                )

                batch_frames = 0
                batch_max_score = 0.0

            for keyword, score in scores.items():

                if score >= DETECTION_THRESHOLD:

                    logger.info(
                        f"wake detected: {keyword} score={score:.3f}"
                    )

                    await websocket.send_json({
                        "type": "wake",
                        "model": keyword,
                        "score": float(score),
                    })

                    # Reset so the model's internal buffer doesn't
                    # immediately re-trigger on the next frame from
                    # the same utterance.

                    model.reset()

                    break

    except WebSocketDisconnect:

        logger.info("wake client disconnected")

    except Exception:

        logger.exception("wake ws loop crashed")
