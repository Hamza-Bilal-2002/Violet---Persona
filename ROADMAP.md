# Violet — Roadmap

Working copy. Edit freely. Memory is the durable source of truth.

## Done

- Monorepo with frontend (Three.js + VRM) + backend (FastAPI + Gemini) + Electron shell
- Backend MVP: WebSocket dialogue, emotion/animation tags, no-emoji + concise rules
- Animation cooldown on end (per-animation)
- Lip-sync (browser TTS boundary pulses today; audio-driven analyser ready for swap)
- Phase 1 Electron shell: frameless transparent 420×640 overlay + tray menu, no auto-DevTools, load-flash hidden
- Cursor head + eye tracking (raw bone, gated by idle state)

## Phase 2 — Voice + fullscreen overlay

The two changes go together because removing the text input makes click-through essential.

- **Wake word**: Porcupine ("Violet"), runs locally in Electron, low CPU. Custom keyword trained at Picovoice console.
- **Push-to-talk shortcut**: Global keyboard shortcut (default suggestion `Ctrl+Alt+V` — easy to remember, distinctive). Press to start listening, auto-stop on silence. Configurable later.
- **Both PTT and wake word active simultaneously**; either path triggers the listen pipeline.
- **STT**: Faster-Whisper as a sibling container. Mic captures until silence; audio posted to `/transcribe`; transcript flows into existing `/chat/ws`.
- **Mic capture pipeline**: trigger (wake or PTT) → record → VAD silence detection → send → speak reply → hide window or stay visible per dwell timer.
- **Fullscreen window**: BrowserWindow grows to full primary display; frameless + transparent + always-on-top stays. Avatar positioned bottom-right of the canvas, above the Windows taskbar tray.
- **Click-through**: `setIgnoreMouseEvents(true, {forward: true})` by default. Per-frame raycast in renderer; when cursor over avatar mesh → re-enable mouse, else pass clicks through.
- **Cursor tracking across full screen**: with `forward: true`, mousemove fires regardless of click-through state. Head/eye tracking finally covers the entire desktop, not just the small window bounds.
- **Chat input UI removed**. Voice is the only input. (Keep ENABLE_TEST_DIALOGUE flag for dev fallback.)
- **Reconnection logic** in BackendClient (small, free to add here).

## Phase 3 — PC task automation

- Gemini function calling: define tool schemas in backend (`play_spotify`, `add_calendar_event`, `set_alarm`, `open_app`, `system_volume`, etc.)
- Backend sends `tool_call` frames; Electron renderer (or main process) executes locally; returns `tool_result`. Loop continues.
- Start simple: open URL, open app by name, system volume, sleep PC. Then Spotify (URI scheme or Web API). Then Calendar (Outlook/Google API).
- Tools execute in **Electron**, not in the Docker backend container (backend can't reach host apps).

## Phase 4 — Polish

- **Swap browser TTS → Piper** container. Big quality jump in voice. Activates the audio-driven `LipSyncManager.attachAudio()` path that's already built — no further lip-sync code change required.
- **Opacity-on-hover**: cursor approaches the avatar → fade material opacity ~30% so it never feels like a popup blocking work, can be disabled from the tray menu.
- **Conversation persistence**: SQLite-backed history so sessions survive restarts.
- **RAG**: ChromaDB sibling container with personal docs/PDFs for factual recall.
- **Reconnection polish**: exponential backoff, visible "reconnecting" state.
- **Packaging**: electron-builder → single Windows installer (.exe). Tray icon promoted from placeholder to real artwork.

## Open ideas (capture, decide later)

- Lip-sync further: formant analysis on top of band amplitude (cleaner vowel shapes). Only consider if Piper still feels mushy. (User suggestion 2026-05-22)
- ElevenLabs/Azure TTS as a swap option — they emit visemes natively, would simplify lipsync. Cost > local.
- Mobile companion via Tailscale (talk to backend from phone, no local tools).
- Webcam-driven emotion sensing — detect user's expression, react.

## Recently added user notes (2026-05-22)

- Fullscreen click-through window (folded into Phase 2 — see above)
- Cursor tracking across whole screen (folded into Phase 2)
- update the eye tracking, if the cursor is really close to or ontop of the avatar's face (only face), gently reset the eyes back to default position. (polish phase)
- Opacity-on-hover (Phase 4 polish)
- Lip-sync improvements (after Phase 4 Piper swap — see Phase 4)
- reminder for addition of more emotions and animations.
- reducing the ammount of unclickable border around the model.
- optamizing the processes whereever possible without sacrifizing any performance. following the best practises and not loading anything thats not needed.
- when avatar is hidden, stop all animations to reduce work load.
- add mtoon shaders or suggest better options for better model look. (phase 4).