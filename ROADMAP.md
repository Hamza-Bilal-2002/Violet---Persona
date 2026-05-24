# Violet — Roadmap

Working copy. Edit freely. Memory is the durable source of truth.

## Done

- Monorepo: frontend (Three.js + VRM) + backend (FastAPI + OpenAI) + speech (Whisper tiny container) + wake (openwakeword container) + Electron shell
- Backend dialogue with emotion/animation tags, no-emoji + concise rules. Loose-fallback tag parser recovers from model deviations.
- Phase 1 Electron shell: frameless transparent overlay covering the work area + tray menu, no load-flash
- Cursor head + eye tracking (raw bone, gated by idle state)
- **Phase 2 — voice + fullscreen overlay (closed)**: wake word ("alexa" via openwakeword), PTT (Ctrl+Alt+V), STT (Whisper), voice-only input, click-through with cursor-over-avatar hit-test, BackendClient auto-reconnect with visible status, pause render loop when hidden, voice-input surfaces a hidden overlay, Docker stack auto-starts with Electron, wake on by default.
- **Phase 3 — PC task automation (closed)**: 7 tools — `open_url`, `open_app`, `system_volume`, `lock_pc`, `sleep_pc`, `spotify_search`, `media_control`. Deferred-execution infrastructure for screen-interrupting tools so lock/sleep wait for the avatar to finish speaking.
- LLM provider: OpenAI gpt-4o-mini (paid). Swapped from Gemini due to free-tier limits.

## Phase 4 — Polish, persistence, packaging

### 4.1 Visual polish

- Face-proximity eye reset — eyes gently snap to a neutral forward position when the cursor is close to or on the avatar's face (head keeps tracking)
- Shrink unclickable border around the model — tighten the hit-test (smaller bounding sphere, or per-frame mesh raycast if perf allows)
- Opacity-on-hover — material opacity fades when cursor approaches the avatar, with a tray toggle to disable

### 4.2 Voice quality

- **Piper TTS** container — biggest single voice upgrade. Activates the audio-driven `LipSyncManager.attachAudio()` path that's already built.
- **Better voice input** — user reports listening is weak. Likely Whisper "tiny" → "base" or "small" model swap, plus VAD threshold tuning in `MicCapture.js`.
- Lip-sync improvements — formant analysis on top of band amplitude. Only if Piper still feels mushy.

### 4.3 Memory and persistence

- **SQLite conversation persistence** — Violet remembers context across app restarts. Currently the `ChatSession` resets on every WS reconnect.
- **Long-term "permanent memory"** — RAG (ChromaDB sibling container) for personal docs, facts about the user, things she should always know. Different from per-conversation history.

### 4.4 Final polish and packaging

- More emotions and animations — content additions; FBX clips into `frontend/animations/` and system-prompt updates
- Custom "Violet" wake word — replace the `alexa` placeholder via the openwakeword training Colab
- MToon shader tuning / lighting pass — improve the model's look without changing geometry
- **Spotify playback via Web API** — full programmatic play/queue (OAuth flow + token refresh). Prerequisite for the .exe release.
- **electron-builder packaging** — single Windows `.exe` installer with real tray-icon artwork

## Open ideas (defer)

- ElevenLabs / Azure TTS swap option — they emit visemes natively, would simplify lipsync. Cost > local.
- Mobile companion via Tailscale (talk to backend from phone)
- Webcam-driven emotion sensing — detect user's expression, react
- Calendar integration (Outlook COM or Google API) — deferred from Phase 3
