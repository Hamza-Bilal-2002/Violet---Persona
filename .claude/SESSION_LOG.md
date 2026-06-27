# Session Log

Running checkpoint so a fresh session can resume without re-reading everything.
Most recent entry on top. Keep entries short. See ROADMAP.md for the plan;
this is what we actually did. Pairs with the memory index (MEMORY.md).

---

## 2026-06-27 (later) — Finalized for now: full README + pushed to origin

- Hamza is wrapping the project up at this state (may or may not revisit). Two
  closing tasks done:
- **Rewrote the root `README.md`** from scratch — the old one was frontend-only
  and listed memory/RAG/Ollama/Whisper/Kokoro/multi-agent as "planned" when
  they're built. New one documents the true scope, big-things-first: PC tools
  (whatsapp/spotify/volume/brightness/lock/sleep/media/apps/urls), RAG memory +
  proactive reminders + absence awareness, personalities + Deep/Text modes, the
  3-brain LLM routing (local Ollama / OpenAI / NVIDIA NIM) with auto-fallback,
  the voice pipeline (openWakeWord→Whisper→Piper + lip sync), the VRM avatar,
  Settings, the Dockerized microservice backend + compose network, and the .exe.
  Every claim verified against code before writing.
- **Pushed everything to origin/main** (`Hamza-Bilal-2002/Persona`) — was 10
  commits ahead; now synced through `635dd43`. Also committed a trailing-newline
  fix in text_mode.json.

## 2026-06-27 — Package the overlay client as a distributable Electron app

- The shell was already a full Electron app but had **never been packaged** —
  always ran in dev mode (`IS_DEV` true whenever `!app.isPackaged`), so the
  production code paths were untested and two were broken for a `file://` load.
- **Renderer prod-fixes:** vite `base: "./"` (built index.html used absolute
  `/assets/...` URLs → 404 over file://); moved `models/` + `animations/` into
  `frontend/public/` so vite copies them into `dist/` (the renderer loads them
  via relative `./models` / `./animations`, which dev served from root but the
  build never copied). Rebuilt — dist now has relative URLs + both asset dirs.
- **electron-builder** added to `client/electron` (NSIS installer + portable
  exe, x64, output `client/dist-app/`). `frontend/dist` shipped as
  `extraResources` → `resources/frontend/dist`, which is exactly where the
  existing `__dirname/../frontend/dist` resolves inside `app.asar` — zero path
  change. `asarUnpack` whatsapp-web.js/puppeteer so Chrome can spawn. Scripts:
  `build:frontend`, `dist`, `dist:dir`.
- **App icon:** `scripts/make-app-icon.js` draws a 256x256 violet disc PNG
  procedurally (zlib, no deps), wired to postinstall (tray PNG was 32px, too
  small for the .ico).
- **dockerCompose.js:** packaged installs have no co-located `server/`, so
  auto-start now skips cleanly when no compose file is found and honors
  `PERSONA_SERVER_DIR`. Backend stays Dockerized + separate; the .exe is the
  client only, still talks to localhost:8000.
- **winCodeSign gotcha:** electron-builder's winCodeSign bundle has macOS
  symlinks that need the Windows symlink privilege to extract → fails on a
  stock machine. Worked around here by pre-extracting the cached `.7z` without
  the `darwin` dir into `…Cache/winCodeSign/winCodeSign-2.6.0/`. Permanent fix
  for a clean machine = enable Developer Mode (or build elevated). Documented
  in the electron README.
- **Built successfully:** `Violet Setup 0.1.0.exe` + `Violet-0.1.0-portable.exe`
  (~114 MB each, unsigned). Verified packaged layout (resources/frontend/dist
  with models+animations, asarUnpack'd puppeteer/whatsapp). **On-screen launch
  verification still pending — Hamza to run the exe.** Commit `cdfe892`.

## 2026-06-24 (later) — Absence awareness

- Violet now reacts when Hamza comes back after a long gap (PC off, or just
  idle/not talking to her). On the first message back she acknowledges the
  absence in character — scaled to her personality — *then* answers the actual
  question. Folded into the reply, not a separate spoken line.
- **How:** `EventStore` persists `last_seen_utc` (meta kv). Each real dialogue
  turn computes `now - last_seen`; if ≥ `ABSENCE_THRESHOLD_SECONDS` (default
  2h, env-tunable `PERSONA_ABSENCE_THRESHOLD_SECONDS`), `main._absence_note()`
  injects a one-shot instruction via the new `ChatSession.set_absence_context()`
  (ephemeral system line, same pattern as time/memory context), then stamps
  `last_seen = now` so the next message doesn't re-trigger. Because last_seen is
  only written on real user turns (not on connect), a PC-off gap survives the
  shutdown and the idle-while-running gap is caught the same way.
- Skipped in deep/text private modes (an in-scene line shouldn't be derailed by
  a meta "where were you"). Backend-only; the reply is spoken normally.
- Verified: backend compiles + parses.

---

## 2026-06-24 — Schedule pane in Memory window + auto-clear spent tasks

- **Scheduled tab** added to the Memory window (`memoryView.html`): a
  Memories / Scheduled toggle. The Scheduled pane lists everything Violet has
  on the books — title, Event/Reminder badge, local time + countdown — with a
  per-row remove button. Search/Reset are memory-only (hidden on the schedule
  tab); tab badges show live counts. IPC `events:list`/`events:cancel` in
  `memoryWindow.js`, exposed as `memoryApi.events`/`cancelEvent` in
  `memoryPreload.js`.
- **Backend**: new `GET /events` + `DELETE /events/{id}` (`_public_event`
  serializer with local when-string + countdown). `EventStore.delete()`
  hard-removes a row.
- **Auto-clear after speaking**: the scheduler now *deletes* a task once it
  voices its terminal line — a fired one-shot reminder, or the "how did it go?"
  follow-up after an event — instead of leaving a `done` tombstone. Intermediate
  heads-ups (day-before / day-of) still only flip their flag. Each auto-clear
  also broadcasts a "Cleared from your schedule" notice toast. This is the
  "ask, then delete" behaviour Hamza wanted.
- **Notifier**: shorter cards (tighter padding, 26px badge, single-line detail)
  and moved to `bottom: 14px` — the overlay is sized to the work area, so it now
  sits just above the taskbar like a Steam achievement (was 104px, too high).
- Verified: backend compiles, Vite build passes (50 modules), JS parses.

---

## 2026-06-23 (later still ×2) — Action notifier + text-mode opacity

- **Action notifier**: Violet's behind-the-scenes actions now surface as a
  subtle, achievement-style toast near the avatar. Backend emits a `notice`
  frame (`_notice`/`_send_notice` in main.py) on memory save, reminder/event
  scheduled, event cancelled, memory forgotten; auto-extraction broadcasts
  "Violet will remember this" when it stores new facts. New
  `client/frontend/js/ui/actionNotifier.js` (bottom-right, dark-glass + amber,
  icon badge with a one-shot spark bloom, whisper-thin auto-dismiss timer,
  stacks newest-lowest, pointer-events:none). Deliberately a separate surface
  from `modeNotifier` (top-center warnings). Wired via `BackendClient.onNotice`
  → `AvatarRuntime.actionNotifier`. SVG glyphs (memory/reminder/event/forget),
  reduced-motion respected.
- **Text-mode chatbox** background opacity raised 0.62 → 0.88 (more readable
  over busy desktops).
- Verified: backend compiles, Vite build passes, JS parses.

---

## 2026-06-23 (later still) — Time awareness + proactive event memory

- **Device time → the time-blind local model**: the renderer sends
  `{type:"client_time", iso, tz}` on WS open (`BackendClient` open handler).
  `main._time_context()` injects "CURRENT DATE & TIME …" as an ephemeral
  system line every turn (`ChatSession.set_time_context`, alongside the
  memory context). No container-TZ dependency — the device tz is the source
  of truth and is persisted for the scheduler.
- **Event/reminder store** (`server/api/app/events.py`, `/data/events.db`):
  events stored as **absolute UTC** so they survive shutdowns (compare to
  now on next boot; overdue items fire late). `resolve_when()` parses "in a
  week / 2pm tomorrow / in 20 min" via **dateparser** (added to
  requirements; lazy-imported) relative to real now + device tz.
- **Tools** (`schedule_event`, `list_events`, `cancel_event`, server-side in
  `_execute_server_tool`, renamed from `_execute_memory_tool`, now takes
  `conn` for tz). The model is told to call `schedule_event` whenever a
  future plan/meeting/date is mentioned.
- **Proactive follow-ups**: a background scheduler (`_scheduler_loop`, 30s,
  started on `startup`) checks `events.due()` and voices, to a live
  non-private client, the right stage per event — heads-up the day before,
  reminder the day of (with relative time), and "how did it go?" once past
  (`AFTER_BUFFER` 2h). Lines are **LLM-generated in character**
  (`_gen_proactive_sync`) with a template fallback, pushed as normal `reply`
  frames (the renderer already speaks unsolicited replies).
- **First-boot-of-day briefing**: on the first connect of the local day
  (`_maybe_briefing`, tracked via persisted `last_briefing_date`), she greets
  + runs through upcoming events; same-day reconnects stay silent. Suppresses
  the day-of reminder for events the briefing already named (the after
  follow-up still fires).
- Verified: backend compiles, event store + due-stages + briefing meta
  unit-tested (incl. overdue catch-up), Vite build passes. dateparser +
  proactive speech need the live stack / image rebuild to exercise.
  See [[event-memory]].

---

## 2026-06-23 (later) — More voices + global voice override

- **More Piper voices**: TTS Dockerfile now bakes 12 voices (was 4) — extra
  US/UK female + a few male. Downloads are best-effort (a renamed upstream
  path warns + skips instead of failing the build); whatever lands in
  /models is what the api reports installed.
- **Voice catalog**: new `server/api/app/voices.py` (id→label/locale/gender).
  `GET /voices` returns the catalog filtered to what the TTS service
  actually has installed (api fetches `tts:8004/health` via new
  `settings.TTS_URL`; compose sets it). Personality editor options now carry
  the same labelled voice list.
- **Global voice override** (Settings → **Voice**): one chosen voice that
  beats every personality's own voice. Implemented at the **client**
  `TtsClient` chokepoint (`override` wins over `personalityVoice`), NOT in
  the backend — so it also covers Deep Mode and the offline/basic fallback,
  which never hit the api. Persisted in `violet-settings.json`
  (`voiceOverride`), applied on renderer startup (`getSettings`) and live via
  a new `persona:set-voice` IPC + `personaShell.onSetVoice`. "Each
  personality's own voice" clears it. See [[voice-override]].
- Settings wiring: `settings:voices-get` / `settings:voice-set` (persists +
  forwards to renderer) + preload bridges; `fillSelect` generalised to take
  labelled `{id,label}` voices or plain emotion strings.
- Verified: backend compiles, Vite build passes (49 modules), all JS parses.

---

## 2026-06-23 — NVIDIA cloud brain + persona editor in Settings

- **Third brain — NVIDIA NIM**: added a cloud-hosted, OpenAI-compatible
  provider (`integrate.api.nvidia.com/v1`) alongside local Ollama + OpenAI.
  Default model `meta/llama-3.3-70b-instruct` (recommended over Nemotron
  49B for terse, tool-disciplined replies). `llm.py` now resolves
  `provider ∈ {auto,local,nvidia,openai}` per turn; **auto never picks
  NVIDIA** (explicit/paid choice only). Brain selection + NVIDIA key/model
  are runtime-settable and persisted to `/data/llm_runtime.json` (overrides
  env on next start). New `LLMClient` methods: `set_provider`,
  `set_private_provider`, `set_nvidia_model`, `set_nvidia_key`,
  `private_available`/`private_provider`, `runtime_config`.
- **Private-mode routing (posture change)**: deep/text were hard-locked to
  the on-device model. Now a `private_provider` setting (default `local`)
  can be flipped to `nvidia` as an **opt-in testing path** so Hamza can
  test Deep/Text Mode before Ollama is set up. `_run_once` require_local
  branch + all main.py gates use `private_available()`/`private_provider()`.
  Default still local-only; the override is a clearly-warned Settings toggle
  (NVIDIA is cloud + will likely refuse explicit content). See
  [[adult-mode]], [[local-model-fallback]], [[nvidia-brain]].
- **Personality editor**: personalities are now create/edit/deletable from
  Settings. `personalities.py` got a writable `/data/personalities` overlay
  (loads over the read-only baked set by id; user file overrides a baked one,
  deleting an override reverts, pure-builtin can't be deleted). REST:
  `GET /personalities/full`, `POST /personalities`, `DELETE /personalities/{id}`.
- **Live re-sync infra**: `main.py` now keeps a `_LIVE` connection registry
  ({ws,session,conn}); a personality edit broadcasts the refreshed roster +
  re-applies the active prompt to non-private live sessions, and a
  private-provider change pushes refreshed deep/text capability frames — all
  without a reconnect.
- **Settings UI**: two new sidebar sections — **AI Model** (brain radios with
  live/ready tags, NVIDIA key+model editor, "currently answering" readout,
  warned Deep/Text-on-NVIDIA toggle) and **Personalities** (roster list with
  active/built-in badges + editor: name, voice/emotion selects, prompt
  textarea, Save / Delete-or-Revert). Backend-backed via new settingsWindow
  IPC + preload bridges. Note: AI Model = backend brain (Tier-1); distinct
  from Offline Mode = client fallback when the backend is down.
- Verified: backend compiles; personality CRUD unit-tested (create/override/
  revert/refuse/validation); electron JS + settings inline script parse.

---

## 2026-06-20 — PC bring-up + Settings overhaul + native avatar tuning

- **Local model live on PC**: backend Dockerized stack runs; Ollama
  (`llama3.1:8b`) pulls + answers, `/health` shows `active_provider: local`.
  Running on CPU for now — RX 6600 (AMD) needs native Ollama + HIP SDK on
  Windows (Docker GPU passthrough is NVIDIA-only); deferred until home.
  Fixed `.env.example` (was stale Gemini; now OpenAI + provider vars).
- **Offline-mode settings**: client fallback now switchable OpenAI ⇄
  Gemini 2.5 Flash (Gemini via its OpenAI-compatible endpoint) with a
  per-provider key editor. `fallbackChat.js` resolves provider+key at call
  time from `violet-settings.json`.
- **Tray makeover**: tray slimmed to quick actions + status (Show/Hide,
  Reload Avatar, Settings…, Personality, Deep/Text Mode, WhatsApp/Spotify
  status+reconnect, DevTools, Quit). Everything tunable moved into one
  **Settings window** (`settingsWindow.js` + `settingsView.html`): dark-glass,
  sidebar-navigated. Sections: Behavior (wake word / text input / fade —
  each a live switch + an "on by default at launch" switch persisted to
  `settings.defaults`, applied in `tray._applyStartupDefaults`), Avatar,
  Connectivity, Memory, Offline Mode, System (pin to taskbar).
- **Native avatar tuning + lil-gui removal**: deleted the in-overlay
  lil-gui (`debugGUI.js`) and ported lighting/camera/position/mesh-
  visibility into the Settings → Avatar section. Fixed the click-through
  bug: lil-gui being open made `_isCursorOverAvatar` return true always,
  freezing the whole transparent window non-pass-through. Bridge:
  `frontend/js/runtime/tuning.js` (snapshot/apply/save) ↔ main
  (`settings:tune-*`, cached snapshot) ↔ Settings UI (amber sliders/colors/
  switches, collapsible groups, Save Look).

---

## 2026-06-20 — Text Mode (muted text roleplay + chatbox)

- Muted text-to-text roleplay; the text sibling of deep mode. Avatar emotes
  + body-animates per message but plays NO audio. Local-model only (same
  provider lock); allows *asterisks*; never breaks character.
- **Generalized the gating**: `conn["adult"]` -> `conn["mode"]` (None|deep|
  text). Both private modes share provider lock + write-none + tool-refuse;
  mutually exclusive. `_run_dialogue_turn(adult=)` -> `(private=)`.
- **Backend**: `server/config/text_mode.json` defaults + `text_mode.py` store
  (writable `/data/text_mode.json` overlay for user-edited scene/rules).
  `llm.py build_text_mode_prompt` (+ `_TEXT_MODE_RULES`). `main.py`
  `set_text_mode` + `set_text_mode_config` frames, `_text_mode_frame`.
- **Frontend**: `ui/chatBox.js` (dark-glass chatbox — bubbles, *asterisk*→
  italic, Enter-send, fullscreen toggle, Scene/Rules settings panel).
  `DialogueManager._speakMuted` (animate+emote, no audio). `BackendClient`
  text-mode routing (`textMode`, `setTextMode`/`setTextModeConfig`/
  `onTextMode`/`onChatMessage`). Tray "Text Mode (local only)" toggle;
  preload/ipc bridges; `.persona-chatbox` in the click-through hit-test.
- Scene + rules editable live from the chat settings, persisted server-side.
- Dormant until the local model runs. See [[text-mode]], [[adult-mode]].

---

## 2026-06-19 — Deep mode (local-model-only private mode)

- A gated conversation mode hard-locked to the local model — never the API.
- **Provider lock** (`llm.py`): `ChatSession.set_require_local(True)` makes
  `_run_once` use ONLY the local provider and raise `LocalModelRequiredError`
  rather than ever falling back to GPT. `build_adult_system_prompt` keeps the
  emotion/animation tags. `local_available()` / `local_provider()` accessors.
- **Backend** (`main.py`): `set_adult_mode` control frame, gated on
  `local_available()` (refuse, don't enable, if no local model). `adult_mode`
  frames (capability on connect + state on toggle + block on local-down).
  These turns: read memory (RAG) but WRITE NONE — skips extraction, skips the
  on-disk transcript, refuses all tools. Personality match suppressed.
- **Config**: `server/config/deep_mode.json`, loaded separately by
  `personalities.adult()`, excluded from the public roster.
- **Client**: tray "Deep Mode (local only)" checkbox (greyed when no local
  model, backend-authoritative); `BackendClient.setAdultMode`/`onAdultMode`
  (no-op in basic mode — defeats the Tier-2 GPT path); preload bridges;
  notifier toasts. Voice via the personality frame.
- Dormant until the local model runs (toggle greyed now). Test at setup.

---

## 2026-06-19 (earlier) — Tier-2 client fallback + TTS normalization (Wave 3)

- **TTS speech normalization** (`server/tts/app/normalize.py`): rewrites
  espeak-hostile tokens before synthesis ("i's"→"eyes", "hmph"→"hmf",
  interjections, percent, elongated vowels). Server-side, engine-independent
  (survives Piper→Kokoro). Only the spoken copy is rewritten. Fixes the
  "extra i's"→"i s" and "hmph"→"h m p h" mispronunciations.
- **Tier-2 client fallback (basic mode)**: when the backend is unreachable,
  `BackendClient` flips to a 'basic' mode (after 3 failed reconnects) and
  routes input to `FallbackChat` → GPT direct via Electron main
  (`client/electron/fallbackChat.js`, key in userData / OPENAI_API_KEY).
  NO tools/RAG/memory; bundled limited personalities
  (`config/basicPersonalities.js`) + hand-authored `config/basicProfile.js`.
  GPT replies plain-text, enqueued with the personality's default emotion.
  Returns to full mode on the next successful WS open (clears ephemeral
  history). `setPersonality`/`send` route by mode — single entry point, so
  VoiceFlow/text/tray unchanged.
- **Notifiers** (`ui/modeNotifier.js`): toast on transitions ("Backend
  offline — basic GPT mode", "Backend online — full mode restored") +
  persistent basic-mode pill. Basic mode suppresses the reconnecting overlay.
- **Kokoro** saved to memory ([[tts-engine-upgrade]]) for the local-model
  setup — Piper→Kokoro is a contained backend swap; frontend stays light
  (TTS is server-side, renderer just plays the WAV).

**Next:** Wave 4 — expand bundled personality roster + a Settings UI field
for the GPT key (currently env var / settings file only). Then local-model
testing when Hamza has his PC (boot Ollama under `--profile local`).

---

## 2026-06-19 (later still) — Switchable personalities (Wave 2)

- **Backend (2a)**: `server/config/personalities/*.json` (angry_gf default, cheerful,
  calm, tsundere) — each with prompt body + TTS voice + default emotion. `personalities.py`
  loads + persists active to `/data/active_personality.txt`. `llm.py` splits the system
  prompt (shared header + rules, swappable personality body); `set_system_prompt()` swaps
  live. `main.py` sends roster + active on connect, handles `set_personality` control
  frames and text "switch to X", GET /personalities.
- **Voice + UI (2b)**: tts service multi-voice (`/synthesize` takes `voice`, 4 voices baked).
  TtsClient.setVoice; BackendClient personality frames + setPersonality; AvatarRuntime sets
  voice on switch + relays tray picks; tray Personality radio submenu.
- Verified backend over WS (switch via frame + text, tone changes) and tts multi-voice.
  Full tray→WS→voice loop needs the live app.

**Next:** Wave 3 — Tier-2 client-side GPT fallback (PC-off → basic mode) + notifiers.

---

## 2026-06-19 (later) — Memory viewer + local-model Tier-1

- **Memory viewer**: tray → Memory → View Memory… (`client/electron/memoryWindow.js`,
  `memoryPreload.js`, `memoryView.html`). Live edit, delete, semantic search, reset.
- **Tier-1 provider abstraction** (`server/api/app/llm.py`): local (Ollama) + GPT, picked
  per turn via `active_provider()` from `LLM_PROVIDER=auto|local|openai`. `auto` probes
  local, falls back to GPT (so it works today). Ollama is a compose service under
  `profiles:[local]`. `/health` reports provider status. See [[local-model-fallback]].

**Next waves (planned, not started):** (6) switchable personalities text+voice — backend
config + tray/voice switch; (7) Tier-2 client-side GPT fallback for PC-off + notifiers.
Decisions locked: Ollama, client-side fallback key, voice-per-personality.

---

## 2026-06-19 — Backend separation + long-term memory system (Phase 5)

**Where we left off:** Long-term memory system fully built and verified end-to-end
over the chat WebSocket. All four planned waves done and committed.

Done this session:
1. **Repo reorg** → `server/` (separable backend) + `client/` (electron + frontend).
   Renamed `backend/` → `server/api`. Compose pinned `name: persona`. Client
   decoupled from shared `config/agent.json` (tray name defaults to 'Violet').
2. **`server/embed`** — fastembed (`bge-small-en-v1.5`, 384-dim, ONNX/CPU) on :8005.
3. **Memory store + RAG** — `server/api/app/memory.py` (`/data/memory.db`), semantic
   search + dedup, injected each turn via `ChatSession.set_memory_context()`.
4. **Auto-extraction + tools + reset** — background fact extraction after each turn;
   server-side `remember/forget/recall` tools; tray → Memory → Reset Memory….

**Key constraint:** local model owns memory in future; GPT is testing-only and must
not have memory access. Extraction uses the same swappable LLM client as the dialogue
so it goes local automatically. See [[memory-system]] memory note.

**Earlier this session:** WhatsApp contact disambiguation picker + silent-send fix;
"Resolving…" stuck-card exception handling; tray WhatsApp/Spotify status dots + QR
popup window; personality changed tsundere → angry girlfriend.

**Next ideas (not started):** screen vision, clipboard/type-into-window, reminders,
WhatsApp read/summarize. Memory system is ready for the local-model switch.

---

## Architecture map (post-reorg)

```
server/                      separable backend (network-only coupling)
  docker-compose.yml         project name pinned `persona`
  config/agent.json          identity source of truth (backend-owned)
  api/    app/{main,llm,memory,store,tools,protocol,config}.py   :8000  /chat/ws + /memory/*
  speech/                    Whisper STT  :8002
  wake/                      openwakeword :8003
  tts/                       Piper TTS    :8004
  embed/                     fastembed bge-small :8005 (memory vectors)
client/
  electron/                  desktop shell; tools/ execute PC actions client-side
  frontend/                  Three.js + VRM runtime (Vite :5173)
```

Memory: `store.py` = short-term convo log (`violet.db`); `memory.py` = long-term
semantic memory (`memory.db`). Tools split: PC actions → forwarded to renderer;
`remember/forget/recall` → executed in api (`SERVER_SIDE_TOOLS`).

**Conventions:** commit per wave/topic, no Claude attribution, no emojis in Violet's
replies, address user as "Hamza".
