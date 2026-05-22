---
name: project-speech-container
description: Wave 1 of Phase 2.B adds a speech-to-text sibling container at port 8002 backed by faster-whisper tiny/int8/cpu, fed by renderer-side MediaRecorder via /transcribe
metadata:
  type: project
---

The Phase 2.B Wave 1 voice flow uses a dedicated `speech/` Docker
service (sibling to `backend/`). It runs faster-whisper tiny int8 on
CPU and exposes `POST /transcribe` (multipart `audio` field) plus
`GET /health` on port 8002.

**Why:** Whisper has heavy native deps (CTranslate2, ffmpeg,
libsndfile) that don't belong in the Gemini-only `api` container.
Splitting them keeps each image small and lets STT backends swap out
without touching dialogue.

**How to apply:** the model size / device / compute_type are three
constants at the top of `speech/app/main.py`. If they change, the
build-time pre-download step in `speech/Dockerfile` (line with
`python -c "from faster_whisper..."`) must also change to match —
otherwise the new model isn't in the image cache and the first
request will stall downloading it. Build expects ~5 min on first
build because of that pre-download; subsequent builds reuse cache.

The renderer side wires through `frontend/js/voice/` (MicCapture +
SpeechTranscriber + VoiceFlow) and `electron/globalShortcut.js`
binds Ctrl+Alt+V as the push-to-talk trigger. See
[[project-voice-flow-shape]] when that exists.
