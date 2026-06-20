# Session Log

Running checkpoint so a fresh session can resume without re-reading everything.
Most recent entry on top. Keep entries short. See ROADMAP.md for the plan;
this is what we actually did. Pairs with the memory index (MEMORY.md).

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
