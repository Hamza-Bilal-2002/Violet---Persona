# Speech service

Local speech-to-text container for Persona. Wraps
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) behind a
single FastAPI endpoint.

## What it does

`POST /transcribe` accepts a single multipart file field named `audio`
(WebM/Opus from the renderer's `MediaRecorder`) and returns
`{"text": "..."}` — the English transcript.

`GET /health` returns `{"status":"ok","model":"tiny"}`.

The Whisper model loads lazily on the first `/transcribe` request.
Subsequent requests reuse the in-memory instance.

## Bring-up

This service is part of the project's `docker-compose.yml`. From the
project root:

```
docker compose up --build speech
```

Or together with the rest of the stack:

```
docker compose up --build
```

First build downloads the Whisper "tiny" weights (~75 MB) into the
image, so expect ~5 minutes of build time on a cold cache. Subsequent
builds are fast.

Health-check it manually:

```
curl http://localhost:8002/health
```

## Swapping the model

`speech/app/main.py` has three knobs at the top:

```python
MODEL_SIZE = "tiny"           # tiny | base | small | medium | large-v3
MODEL_DEVICE = "cpu"          # cpu | cuda
MODEL_COMPUTE_TYPE = "int8"   # int8 | int8_float16 | float16 | float32
```

If you switch sizes you must rebuild the image — the Dockerfile
pre-downloads `tiny` at build time. Change that line to match.

Bigger sizes give better accuracy at higher memory + latency cost.
The matrix is documented at the faster-whisper README.

## Why a separate container

Whisper has heavy native deps (CTranslate2, ffmpeg, libsndfile) that
have no place in the Gemini-only `api` container. Splitting the
service keeps each image small and lets us swap STT backends
(deepgram, vosk, etc.) without touching dialogue.
