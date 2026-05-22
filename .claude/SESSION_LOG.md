# Violet — Session Log

Running cross-session checkpoint. Claude maintains this file; the user
should not need to edit it. Updated proactively when phases close,
when major decisions land, or when an obstacle is worth remembering.

Most recent at the top. Keep entries tight — link to code, don't
re-explain it.

---

## Where we left off (latest first)

### 2026-05-22 — Phase 2.B Wave 1 voice loop fully working

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
