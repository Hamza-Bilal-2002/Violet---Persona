# Violet — Session Log

Running cross-session checkpoint. Claude maintains this file; the user
should not need to edit it. Updated proactively when phases close,
when major decisions land, or when an obstacle is worth remembering.

Most recent at the top. Keep entries tight — link to code, don't
re-explain it.

---

## Where we left off (latest first)

### 2026-05-24 — Mid Phase 3.2; about to swap LLM provider Gemini → OpenAI

**Status:** Phase 3 Wave 3.1 closed (tool-calling protocol +
`open_url`). Wave 3.2 in progress — 3 of 4 tools landed
(`open_app`, `system_volume`, `lock_pc` with deferred-execution
infra). Outstanding work: **`sleep_pc`** (the trivial twin of
lock_pc, will use `deferred: true` flag).

Mid-session decision: swap LLM provider from Gemini to OpenAI.
Reason: even on `gemini-2.5-flash-lite` (15 RPM free tier) the
limit was hitting too fast for daily use. User has a paid OpenAI
key. Target model: TBD next turn (recommending `gpt-4o-mini` for
cost efficiency + reliable function calling). This invalidates
the `backend_mvp_gemini_only` memory.

**What landed today (Wave 3.2 progress):**

- `open_app(name)` — Windows `start "" "<name>"` shell-out, uses
  App Paths registry + Store-app handlers. Strict allowlist on
  name validation to block shell injection.
- `system_volume(action, steps?)` — PowerShell SendKeys of
  VK_VOLUME_UP/DOWN/MUTE. Up/down take a step count (default 3),
  mute is a single toggle. `up`, `down`, `mute` only — absolute
  level needs CoreAudio P/Invoke, punted to 3.3.
- `lock_pc()` — `rundll32 user32.dll,LockWorkStation`. Marked
  `deferred: true` so the screen locks AFTER the avatar finishes
  speaking, not mid-sentence.
- **Deferred-tools infrastructure** — single-slot pending queue
  in `electron/tools/index.js`. `flushDeferred()` fires on
  `DialogueManager.onQueueIdle`; `cancelDeferred()` fires on
  `VoiceFlow.trigger()` (user changed their mind). Two new IPC
  channels: `persona:tools-flush-deferred` and
  `persona:tools-cancel-deferred`.

**Carry-forward / next session:**

1. Confirm OpenAI model (recommended: `gpt-4o-mini`).
2. Refactor `backend/app/llm.py` from `google.generativeai` to
   `openai`. Tool declaration shape differs (OpenAI uses
   `{"type": "function", "function": {...}}`). History
   management is explicit (no ChatSession; we maintain a
   `messages` list ourselves). Tool round-trip pattern: emit
   assistant message with `tool_calls`, then a `tool` role
   message per result, then next assistant message.
3. Update `tools.py` to expose OpenAI-shaped declarations
   (could either keep Gemini protos and convert, or rewrite
   declarations in OpenAI's JSON-schema shape).
4. `backend/.env`: replace `GEMINI_API_KEY` with `OPENAI_API_KEY`.
   Add `OPENAI_MODEL` env var with default `gpt-4o-mini`.
5. `backend/requirements.txt`: add `openai`, can drop
   `google-generativeai` later (or keep for safety).
6. Finish Wave 3.2 → `sleep_pc` (one tiny commit, deferred: true).

**Memory note:** `backend_mvp_gemini_only` is being replaced.
Will update after the swap.

---

### 2026-05-23 — Wave 2 polish + bootstrap; ready for Phase 3

**Status:** Phase 2 fully closed and the launch experience is now
hands-off. Wake word fires, mic captures, Gemini replies — all
without manual setup steps. Phase 3 (PC task automation) is the
next active phase.

**Polish landed today:**

- **Show-on-trigger** — both wake and PTT route through
  `VoiceFlow.trigger()` which asks the shell to show the window
  before starting the listen cycle. New `persona:show` IPC. So
  hiding the overlay via tray no longer mutes the voice path.
- **Gemini free-tier model swap** — default `GEMINI_MODEL` →
  `gemini-2.5-flash-lite` (15 RPM / 1000 RPD vs flash's 5 / 25).
  Override via `backend/.env` for paid tiers.
- **Wake-word diagnostics** — client logs actual AudioContext
  sample rate, audio track info, frame heartbeat + peak Int16
  amplitude; server logs heartbeat batch with max score seen.
  Kept in, paid for themselves once already.
- **Wake model swap** — `hey_jarvis` → `alexa`. Easier to say.
  Pure config change, no rebuild (both models pre-baked in image).
- **Docker auto-start** — `electron/dockerCompose.js` runs
  `docker compose up -d` on app launch, fire-and-forget. Requires
  Docker Desktop running; the renderer's reconnect logic forgives
  bootstrap-order races.
- **Wake on by default** — `tray.js` defaults `wakeWordEnabled =
  true`, `ipc.js` sends the initial toggle when `persona:ready`
  fires (the "everything else is up" moment). Manual toggle off
  still works for privacy moments.

**Known follow-ups (not blocking):**

- **Custom "Violet" wake keyword** still TBD. `alexa` is the
  current placeholder.
- **WO Mic / Windows default device** — both PTT and wake follow
  the system default mic. If the default flips to a virtual driver
  (WO Mic), they'll listen there.
- **Docker Desktop launch-at-login** — user-side setting; flag in
  the launch instructions until we ship a packaged installer that
  prompts for it.

---

### 2026-05-22 (evening) — Phase 2.B Wave 2 done → Phase 2 closed

**Status:** Phase 2 fully closed. The product now has push-to-talk,
streaming wake-word, voice-only input, auto-reconnect with visible
status, and an animation/render pause when the window is hidden.
Next concrete unit of work is Phase 3 (Gemini function calling for
PC task automation).

**What just shipped (4 commits, one per group):**

- **(1/4) Skip per-frame work when window is hidden** —
  `updateLoop.js` early-returns when `document.hidden`. rAF stays
  armed so we resume cleanly; clock drained per hidden tick so the
  first visible frame doesn't jump-cut animations forward.
- **(2/4) Removed chat input UI** — voice is the only input path
  now. `frontend/js/ui/chatInput.js` deleted, AvatarRuntime no
  longer mounts it, style.css and click-through hit-test selectors
  cleaned. `ENABLE_TEST_DIALOGUE` stays as the offline dev fallback.
- **(3/4) BackendClient auto-reconnect** — exponential backoff
  (1→2→4→8→16→30s cap), deliberate `disconnect()` suppresses
  retries, voice indicator gains a parallel `setConnectionState`
  channel that overrides voice state with an amber pulsing
  "Reconnecting..." pill when the socket is down.
- **(4a/4) Wake-word container** — new `wake/` sibling running
  `openwakeword 0.6` on `onnxruntime` CPU, FastAPI on port 8003.
  Bundled `hey_jarvis` keyword for now. Picovoice Porcupine was the
  obvious pick but they killed personal accounts in late 2024.
- **(4b/4) Wake-word renderer client + tray toggle** —
  `WakeWordClient` + `wakeProcessor.js` AudioWorklet. Continuous 16
  kHz mono Int16 PCM streaming over WS. Tray "Wake Word" checkbox,
  default off (privacy). On detect, calls new public
  `VoiceFlow.trigger()` so wake and PTT share the same listen
  cycle. Audio constraints intentionally raw (no AEC/NS/AGC) so
  soft "hey jarvis" utterances aren't suppressed.

**Architecture additions:**

- New container: `wake/` (FastAPI + openwakeword, port 8003,
  WebSocket `/ws` accepts 16 kHz Int16 PCM, emits JSON wake events).
- New frontend module: `frontend/js/voice/WakeWordClient.js` +
  `frontend/js/voice/wakeProcessor.js` (AudioWorklet, runs in
  AudioWorkletGlobalScope so no module imports allowed).
- New IPC channel: `persona:toggle-wake-word` (tray → renderer).
- `voiceIndicator` now has two input channels — voice state and
  connection state — with connection state taking priority.

**Known follow-ups (not blocking, but worth flagging for memory):**

- **Custom "Violet" wake keyword.** Currently we ship `hey_jarvis`.
  Training a "Violet" model is a ~30-sample recording + a
  openwakeword Colab run. Worth doing before packaging.
- **WO Mic / device-selection question** still open. Wake will
  listen on Windows default device, same caveat as PTT.
- **Wake container needs to be built before first use.** Run
  `docker compose build wake` then `docker compose up -d wake`.
  First build takes a few minutes (downloads ~30MB models).

**Next on the roadmap:**

- **Phase 3 — PC task automation** is the next active phase. The
  thesis of the product. Gemini function calling on the backend
  emits `tool_call` frames; Electron main process executes them
  locally (host apps, system volume, etc.). Start with the trivial
  ones (open URL, set volume), then Spotify, then Calendar.

---

### 2026-05-22 (afternoon) — Phase 2.B Wave 1 voice loop fully working

**Status:** end-to-end push-to-talk verified. User reports TTS and
reply quality both feel good.

**What just shipped (in this session):**

- Fixed empty-transcript bug: `faster-whisper 1.0.3` imports
  `requests` directly but doesn't declare it; newer
  `huggingface-hub` stopped pulling it in transitively. Pinned
  `requests==2.32.3` in `speech/requirements.txt`.
- Hardened observability: `SpeechTranscriber.js` now surfaces the
  `error` field from `/transcribe` instead of silently treating any
  500-with-200-shape as "empty audio". This was masking the real
  ModuleNotFoundError.
- Added diagnostic logging in `MicCapture.js` (audio track info,
  AudioContext state, peak RMS at silence-stop). Kept in deliberately
  — paid for itself diagnosing this bug; cheap; useful for the next
  one.
- ROADMAP edits + avatar viewport shrink (`widthMax 420→320`,
  `heightMax 680→480`, `marginBottom 16→10`) committed alongside.

**Known open device-selection question:** `getUserMedia({audio:true})`
picks Windows default input — user's default is "WO Mic Device" (a
virtual driver from phone audio). Not blocking; not a bug. If we
want to override Windows' default later, add a tray-menu mic picker.

**Next on the roadmap:**

- Phase 2 still has unfinished items: wake word ("Violet" via
  Porcupine), fullscreen click-through finalization, remove chat
  input, BackendClient reconnection logic.
- Phase 3 starts after Phase 2 — Gemini function calling for PC
  task automation (open app, system volume, Spotify, calendar).

See `ROADMAP.md` for the full plan and the user's polish-phase notes
(eye reset on face-proximity, opacity-on-hover tray toggle, MToon
shaders, etc.).

---

### 2026-05-21 — Onboarding + framework wired

- `.lgtm/STATUS.md` initialized.
- `.claude/` agent + skill infrastructure configured.
- Project recognized as VRM Avatar Lab (now branded Violet).

---

## Architecture map

```
config/                  agent identity (Violet, Hamza, personality)
                         single source of truth — mounted read-only
                         into backend container, read by Electron
                         and frontend

backend/                 FastAPI + Gemini 2.5 Flash (port 8000)
  app/main.py            /chat/ws WebSocket loop (history-capped 20)
  app/llm.py             system prompt template + Gemini wrapper
  app/protocol.py        parses <emotion .../> + <animation>...
                         tags out of LLM output

speech/                  faster-whisper STT sibling (port 8002)
  app/main.py            /transcribe endpoint, lazy WhisperModel
                         tiny/int8/cpu. VAD filter ON.
  Dockerfile             ffmpeg + libsndfile; weights downloaded on
                         first request to a named volume.

electron/                Desktop overlay shell
  main.js                pre-ready switches + whenReady wiring
  window.js              frameless transparent always-on-top window
                         covering full work area; permission handler
                         for media; setIgnoreMouseEvents default true
  preload.js             window.personaShell API surface
  ipc.js                 hide, set-ignore-mouse, ready, debug-gui
  tray.js                tray menu (show/hide, debug, devtools,
                         pin-to-taskbar, quit)
  globalShortcut.js      Ctrl+Alt+V push-to-talk
  config.js              IS_DEV, paths, agent name pull

frontend/                Three.js + VRM renderer (Vite dev :5173)
  js/app.js              one-liner that spins up RuntimeController
  js/runtime/
    RuntimeController.js bootstraps scene/camera/renderer/controls/
                         GUI + AvatarRuntime; owns getAvatarViewport
                         (bottom-right of canvas)
    AvatarRuntime.js     VRM lifecycle, managers, BackendClient,
                         VoiceFlow, click-through hit-test (bounding-
                         sphere + elementFromPoint for UI escapes)
    updateLoop.js        per-frame order: controls -> anim -> vrm
                         -> lookAt -> lipSync -> render -> onFrame
  js/managers/
    animationManager     FBX clip cooldown (post-end timing)
    expressionManager    VRM blendshapes + blink + emotion intensity
    lipSyncManager       boundary pulses today; AnalyserNode path
                         ready for Piper swap (Phase 4)
    lookAtManager        head bone + eye target, yields to
                         non-idle animations
    dialogueManager      enqueue/speak/finish loop, TTS via
                         SpeechSynthesisUtterance, lip-sync attach
    avatarStateManager   coordinates animation + expression
  js/voice/
    MicCapture           getUserMedia + MediaRecorder + RMS VAD;
                         silence threshold 0.015, 1.5s silence,
                         500ms min speech, 15s max
    SpeechTranscriber    multipart POST to /transcribe; surfaces
                         backend errors as thrown
    VoiceFlow            state machine (idle/listening/thinking/
                         speaking/error), wired to Ctrl+Alt+V
  js/backend/
    BackendClient        WebSocket -> dialogueManager.enqueue
  js/ui/
    chatInput            dev fallback input (ENABLE_TEST_DIALOGUE)
    voiceIndicator       bottom-right pill: listening/thinking/
                         speaking/error with colored pulsing dot
    debugGUI             lil-gui, tray-toggleable
  js/config/             avatarConfig, agentConfig, animations list

.lgtm/                   workflow/skills artifacts
.claude/                 agents, rules, scripts, skill defs
.claude/SESSION_LOG.md   THIS FILE
```

## Conventions to honor

- **Commit cadence**: at every phase/wave/major-achievement boundary,
  not just on request. Split commits by topic (voice-fix and
  ROADMAP-edits don't share a commit). See memory:
  feedback-commit-cadence.
- **No emojis, ever** — system prompt rule, also a project preference.
- **No Co-Authored-By / AI attribution** in commits (CLAUDE.md rule).
- **Never `git add -A`** — stage explicit paths.
- **Agent identity lives in `config/agent.json`** — never hardcode
  "Violet" anywhere.
- **Backend stays Dockerized**, frontend runs outside compose during
  dev (Vite at :5173). See memory: backend_docker_requirement.
- **Lip-sync stays frontend-only** (Web Audio AnalyserNode); backend
  never ships visemes. See memory: lipsync_frontend_only.
- **Emotions are continuous 0..1**, graded not binary. See memory:
  emotion_variable_intensity.
- **Timestamps always from `python .claude/scripts/now.py`** — LLMs
  cannot tell time.

## How to update this file

When closing a phase/wave or after a meaningful debugging
expedition, prepend a new dated entry above the previous "Where we
left off" block. Bump the previous entry below it. Keep it short —
this is a checkpoint, not an essay. Code references > prose.
