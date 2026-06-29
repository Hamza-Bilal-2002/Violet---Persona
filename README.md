<div align="center">

# Persona — "Violet"

### A Siri/Jarvis-style, always-on AI desktop companion with a living 3D body.

Violet is a real-time 3D avatar that floats over your Windows desktop, listens for a wake word, talks back in a natural voice, **runs your PC for you**, and **remembers your life across restarts** — backed by a fully containerized, self-hostable AI stack with local-first models and cloud fallbacks.

Not a chat window. A character that lives on your screen, sees what you ask, acts on it, and reacts to you.

![status](https://img.shields.io/badge/status-feature--complete_build-7c3aed)
![platform](https://img.shields.io/badge/desktop-Windows_(.exe)-0a84ff)
![backend](https://img.shields.io/badge/backend-Docker_Compose-2496ed)
![license](https://img.shields.io/badge/license-MIT-22c55e)

</div>

---

## Table of contents

- [What it actually does](#what-it-actually-does)
- [PC automation & tools](#-pc-automation--tools)
- [Memory, reminders & awareness](#-memory-reminders--awareness)
- [Personalities & private modes](#-personalities--private-modes)
- [A multi-brain mind (LLM routing & fallbacks)](#-a-multi-brain-mind)
- [Voice pipeline](#-voice-pipeline)
- [The avatar](#-the-avatar)
- [Settings: limitless configuration](#-settings-limitless-configuration)
- [Architecture](#-architecture)
- [Technology stack](#-technology-stack)
- [Getting started](#-getting-started)
- [Building the desktop app (.exe)](#-building-the-desktop-app-exe)
- [Roadmap](#-roadmap)
- [Author & license](#-author--license)

---

## What it actually does

You say **"Hey Jarvis"** (or hit `Ctrl+Alt+V`), and Violet wakes up. You talk to her like a person. She:

- **Acts on your PC** — opens apps and URLs, sets volume and screen brightness, mutes your mic, locks or sleeps the machine, controls media, plays Spotify, and **sends WhatsApp messages**.
- **Remembers you** — long-term semantic memory (RAG) that survives reboots: facts about you, your preferences, things you told her weeks ago.
- **Manages your time** — schedule reminders in natural language ("remind me in 20 minutes", "I have a meeting next Tuesday"); she brings them up proactively, on her own, at the right moment — and asks how it went afterwards.
- **Notices you** — knows when you've been gone for hours and reacts in character when you return.
- **Has a body** — a VRM 3D model that animates, emotes, lip-syncs to her own voice, and tracks your cursor, rendered as a transparent click-through overlay above everything.
- **Has a personality** — switchable characters with distinct voices, plus private roleplay modes that run **only** on the local model.
- **Runs anywhere** — the entire brain is a Docker Compose stack you can deploy on any machine; the desktop client ships as a **standalone Windows `.exe`**.

---

## 🛠 PC automation & tools

Violet doesn't just answer — she *does*. The LLM is given a toolbox and decides when to use it; the desktop shell executes the action and reports back so she can confirm it in her own words.

| Tool | What it does |
|------|--------------|
| **`send_whatsapp`** | Sends a real WhatsApp message via a logged-in WhatsApp Web session (QR pairing, persisted) |
| **`spotify_play`** / **`spotify_control`** | Plays a track/artist/playlist and controls playback (play/pause/skip) via the Spotify Web API (OAuth) |
| **`media_control`** | System-wide media keys — play/pause/next/previous for any player |
| **`system_volume`** | Set or nudge the master volume |
| **`brightness`** | Adjust the display brightness |
| **`mic_mute`** | Mute/unmute the microphone |
| **`lock_pc`** | Lock the workstation |
| **`sleep_pc`** | Put the machine to sleep |
| **`open_app`** | Launch a desktop application by name |
| **`open_url`** | Open a link in the default browser |

**Smart deferral:** screen-interrupting actions (`lock_pc`, `sleep_pc`) don't fire mid-sentence — they're held until Violet has finished speaking her reply, so locking the screen never eats her last line.

Beyond device control, the model also wields **memory tools** (`remember`, `forget`, `recall`) and **scheduling tools** (`schedule_event`, `list_events`, `cancel_event`) — see below.

---

## 🧠 Memory, reminders & awareness

Three independent systems give Violet genuine continuity:

### Long-term semantic memory (RAG)
- Conversations and facts are embedded into **384-dim vectors** (local `bge-small-en-v1.5` via fastembed) and stored in SQLite.
- Relevant memories are retrieved by similarity and injected into context on every turn — so she recalls what matters without stuffing the whole history in.
- **Auto-extraction** quietly captures durable facts as you talk; explicit `remember` / `forget` / `recall` tools let her (and you) manage it directly. A tray action resets memory.
- **Privacy posture:** memory is owned by the **local** model. The cloud path runs in a restricted "basic" tool mode so an external provider never touches your stored memories.

### Time-aware events & proactive reminders
- Natural-language scheduling ("in a week", "2pm tomorrow") parsed against your **device clock + timezone** (the container clock is UTC; the device is the source of "now").
- Everything is stored as an **absolute UTC instant**, so reminders survive shutdowns — a moment that passed while the PC was off simply fires (late) on the next boot.
- A background scheduler voices **proactive, in-character** follow-ups: a heads-up the day before, a reminder the day of, and a *"how did it go?"* afterwards — then clears the task once it's spent (after asking).
- A **first-boot-of-the-day briefing** surfaces what's coming up. A **Schedule pane** in the Memory window shows everything she's tracking.

### Absence awareness
- Violet persists when you were *last actually talking to her*. Come back after a long gap (PC off, or just ignored) and her first reply folds in a reaction — *"you were gone forever, where were you… anyway, here's what you asked"* — scaled to her personality.

---

## 🎭 Personalities & private modes

- **Switchable personalities**, each a backend config defining tone, behavior, **and voice**: `angry_gf`, `calm`, `cheerful`, `tsundere` — picked from the tray, applied instantly to both text and speech.
- **Identity is backend-owned** (`server/config/agent.json`) and decoupled from the client, so the same renderer can wear any character.
- **Offline basic personalities** keep her in character even when the backend is down.
- **Deep Mode** — an explicit, uncensored roleplay mode gated **hard** to the local model (never the cloud). Tray-toggle only, greyed out when no local model is reachable.
- **Text Mode** — a muted, text-to-text roleplay experience (editable scene + rules, asterisk action narration), also local-only. She never breaks character.

---

## 🤖 A multi-brain mind

Violet can run on **three interchangeable "brains,"** selected at runtime from Settings — and `auto` chains them for resilience:

| Provider | Model | Role |
|----------|-------|------|
| **Local (Ollama)** | `llama3` (or any GGUF you pull) | Primary, private, offline-capable. Owns memory & private modes. |
| **OpenAI** | `gpt-4o-mini` | Cloud fallback — fast and cheap when the local model is unreachable. |
| **NVIDIA NIM** | `meta/llama-3.3-70b-instruct` | A heavyweight cloud brain (70B) for higher-quality reasoning, opt-in. |

- **`auto`** prefers the local model and **falls back to GPT** automatically if it's down — so the stack works today with *no* local model, and gets fully private the moment you start Ollama.
- A further **client-side basic fallback** keeps the avatar responsive even if the entire backend is offline.
- Every provider is OpenAI-compatible (just a different `base_url`), so adding a fourth brain is a config line. The architecture is built so **different models can serve different tasks** — local for private/memory work, a big cloud model for heavy reasoning — giving effectively **limitless configurations**.

---

## 🎙 Voice pipeline

A full, local-first speech loop — no browser Web Speech dependency:

```
"Hey Jarvis" / Ctrl+Alt+V
        │
   wake word  ──►  openWakeWord (ONNX, streaming 16kHz PCM)
        │
   mic capture ──► MediaRecorder
        │
   speech-to-text ──► faster-whisper (tiny, int8, CPU)  →  transcript
        │
   the mind ──► LLM (local / OpenAI / NVIDIA) + tools + memory
        │
   text-to-speech ──► Piper neural TTS (ONNX)  →  WAV
        │
   lip sync ──► Web Audio AnalyserNode drives visemes in real time
```

- **12 baked neural voices** (US/UK, female & male) selectable per personality, with a **global voice override** in Settings that beats every personality — even offline.
- A text-normalization layer cleans up numbers, symbols, and abbreviations before synthesis, and is engine-independent (survives a TTS engine swap).
- On-screen **voice indicator** shows listening/thinking/speaking state.

---

## 🧍 The avatar

Built on **Three.js + VRM 1.0**, rendered as a frameless, transparent, always-on-top overlay with **cursor-driven click-through** (clicks pass through to your desktop except when you're interacting with her):

- **Animations** — FBX clips (idle, talking, thinking, happy, reacting, waving) with runtime blending, smooth fade transitions, cooldowns, and automatic idle recovery.
- **Expressions** — native VRM blendshapes (happy, angry, sad, relaxed, surprised, blink) driven by **continuous, graded emotion intensity** (0..1) sent from the backend — not binary on/off.
- **Lip sync** — real-time viseme generation from the actual audio waveform, entirely frontend-side (the backend never ships visemes).
- **Look-at / head tracking** — she follows your cursor across the whole desktop.
- **Dialogue manager** — queue-based speech with priority handling, interrupts, and animation/emotion synchronization.

---

## ⚙ Settings: limitless configuration

A dedicated Settings window (plus a rich tray menu) exposes:

- **AI model** — `auto` / local / OpenAI / NVIDIA, switched live.
- **Voice** — global override across all 12 voices.
- **Personality** — swap character (and voice) on the fly.
- **Private modes** — Deep Mode & Text Mode toggles (local-gated).
- **Integrations** — WhatsApp pairing (QR window) and Spotify connect (OAuth).
- **Memory** — browse stored memories and the live schedule pane; reset memory.

---

## 🏗 Architecture

A clean **monorepo** split into a **separable, deployable backend** and a **portable desktop client** — one git repo, never two.

```
┌──────────────────────────────  client/  (Electron desktop app → .exe)  ─────────────────────────────┐
│                                                                                                       │
│   electron/        frameless transparent overlay · tray · global hotkey · multi-window               │
│      ├─ window / tray / ipc / globalShortcut                                                          │
│      ├─ tools/     PC automation handlers (volume, brightness, lock, sleep, media, apps, urls)        │
│      ├─ spotify.js (OAuth, violet:// protocol)   ·   tools/whatsapp.js (whatsapp-web.js + puppeteer)  │
│      ├─ memoryWindow · settingsWindow · qrWindow                                                      │
│      └─ dockerCompose.js  (auto-starts the backend stack)                                             │
│                                                                                                       │
│   frontend/        Three.js + VRM renderer (Vite build)                                               │
│      └─ core · loaders · managers (animation, expression, lipSync, lookAt, dialogue) · voice · tts    │
│                                                                                                       │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                 │  WebSocket /chat/ws  +  HTTP (CORS)
                                                 ▼
┌──────────────────────────  server/  (Docker Compose · network: persona_net)  ──────────────────────┐
│                                                                                                      │
│   api     :8000   FastAPI orchestrator — LLM routing, tools, memory, events, personalities, modes    │
│   speech  :8002   faster-whisper (tiny, int8) — speech-to-text                                        │
│   wake    :8003   openWakeWord (ONNX) — wake-word detection over streaming PCM                         │
│   tts     :8004   Piper (ONNX) neural TTS — 12 baked voices                                            │
│   embed   :8005   fastembed (bge-small-en-v1.5) — 384-dim embeddings for RAG                           │
│   ollama  :11434  local LLM (profile: local) — private primary brain                                  │
│                                                                                                      │
│   volumes: persona_data (SQLite: memory + events) · whisper_cache · ollama_models                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Why it's built this way:**
- The backend is reachable **only over HTTP/WS** and pins its compose project + named volumes, so it's **fully relocatable and deployable on its own** — host it on a server and point any client at it.
- The client is **fully portable** — a single Windows `.exe` (installer or portable) that auto-starts the backend and reconnects on its own.
- Each capability is its own small service, so STT, TTS, wake-word, and embeddings scale and fail independently.

---

## 💻 Technology stack

**Backend** · Python · FastAPI · Uvicorn · WebSockets · Pydantic · Docker · Docker Compose
**AI / LLM** · Ollama (local) · OpenAI `gpt-4o-mini` · NVIDIA NIM `llama-3.3-70b` · OpenAI SDK
**Speech** · faster-whisper (Whisper tiny, int8) · openWakeWord (ONNX) · Piper neural TTS · *(Kokoro TTS — planned naturalness upgrade)*
**Memory / RAG** · fastembed · `bge-small-en-v1.5` · SQLite · dateparser (NL time parsing)
**3D / Frontend** · Three.js · `@pixiv/three-vrm` · three-stdlib · Vite · Web Audio API
**Desktop** · Electron · electron-builder · whatsapp-web.js · puppeteer · qrcode · Spotify Web API

---

## 🚀 Getting started

> **Prerequisites:** Docker Desktop (backend) and Node.js 18+ (client).

### 1. Bring up the backend
```bash
cd server
docker compose up -d            # api, speech, wake, tts, embed
# optional — fully private local brain:
docker compose --profile local up -d
docker compose --profile local exec ollama ollama pull llama3
```
Set your cloud keys in `server/api/.env` (`OPENAI_API_KEY`, and `NVIDIA_API_KEY` if used). With no local model, `LLM_PROVIDER=auto` simply falls back to OpenAI.

### 2. Run the desktop client (dev)
```bash
cd client/electron
npm install
npm run dev                     # starts Vite + launches the overlay
```
The shell also fires `docker compose up -d` for you on launch, so the backend comes up automatically.

**Usage:** say **"Hey Jarvis"** or press **`Ctrl+Alt+V`** to talk. Left-click the tray icon to show/hide; right-click for personality, modes, integrations, and settings.

---

## 📦 Building the desktop app (.exe)

The client packages into a standalone Windows application via electron-builder:

```bash
cd client/electron
npm run dist                    # → client/dist-app/
```

Produces:
- **`Violet Setup <version>.exe`** — NSIS installer (custom install dir, Start-menu + desktop shortcuts)
- **`Violet-<version>-portable.exe`** — single-file portable, no install

The build ships the Vite output + Electron shell together; the backend stays Dockerized and separate (the app talks to it over `localhost:8000`, or point `PERSONA_SERVER_DIR` at a server folder). Builds are currently **unsigned** (SmartScreen warns on first run).

> **One-time note:** on a stock Windows machine, enable **Developer Mode** before `npm run dist` — electron-builder's signing bundle contains symlinks that need the privilege. Full details in [`client/electron/README.md`](client/electron/README.md).

---

## 🗺 Roadmap

Violet is feature-complete for personal use; natural next steps:

- **Kokoro TTS** — drop-in naturalness upgrade over Piper (normalization layer already engine-agnostic).
- **Custom cloned voice** — XTTS / GPT-SoVITS for a bespoke Violet voice.
- **Vision** — image understanding inside Text Mode and live screen awareness.
- **Remote / LAN access** — reach a hosted backend from any device.
- **Auto-update & code signing** for the desktop app.
- **Hardware acceleration** — native AMD-GPU Ollama path on Windows.

---

## 👤 Author & license

**Hamza Bilal** — AI Engineer · [github.com/Hamza-Bilal-2002](https://github.com/Hamza-Bilal-2002)

Released under the **MIT License**.

<div align="center">

*Persona / Violet — built to prove a desktop AI can have a body, a memory, and a mind of its own.*

</div>
