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

---

## Phase 5 — Local LLM, RAG Memory, Remote Access

Research written before Electron `.exe` packaging. Read this before starting Phase 5.

### 5.0 Target Architecture

```
Main PC (server)                      Laptop (client)
────────────────────────────────      ──────────────────────────
Docker Compose                        Electron .exe
  ├── api          (FastAPI)      ←──   WebSocket + HTTP
  ├── llm          (Ollama)
  ├── whisper      (Whisper base)
  ├── tts          (Piper TTS)
  ├── rag          (ChromaDB)
  └── whatsapp     (future)
```

The Electron `.exe` on the laptop points `BACKEND_URL` to the main PC's Tailscale IP
instead of localhost. Everything else — the WebSocket protocol, tool execution,
VRM renderer — stays identical.

---

### 5.1 Hardware Assessment — Main PC

| Component | Spec | Notes |
|-----------|------|-------|
| CPU | Ryzen 5 5600 (6c/12t, up to 4.4 GHz) | Handles embeddings + CPU fallback |
| GPU | AMD RX 6600 (8 GB GDDR6) | Key constraint — caps model size at ~8B Q4 |
| RAM | 16 GB DDR4 | Sufficient; 32 GB would allow larger context windows |
| OS | Windows 10/11 | AMD GPU inference runs via Vulkan (see §5.2) |

The 8 GB VRAM is the binding constraint. At Q4_K_M quantization, it allows models
up to ~8B parameters loaded entirely on-GPU. That is still excellent quality for
short conversational replies and function calling.

---

### 5.2 Local LLM Inference — AMD GPU on Windows

#### The AMD / CUDA problem

NVIDIA CUDA dominates the local LLM ecosystem. AMD's ROCm stack has solid Linux
support but Windows ROCm is still experimental and driver-sensitive. The safe,
proven path for AMD on Windows is **Vulkan** — a cross-vendor GPU API supported
natively by llama.cpp (which Ollama uses under the hood).

#### Inference backends

| Backend | AMD Windows | Notes |
|---------|-------------|-------|
| **Ollama** | ✅ Vulkan (v0.3+) | Easiest, Docker image, native tool calling |
| llama.cpp | ✅ Vulkan | Ollama uses this internally |
| LM Studio | ✅ Vulkan | Good for testing models before committing |
| koboldcpp | ✅ Vulkan | Alternative if Ollama has issues |
| ROCm direct | ⚠️ Windows experimental | Faster than Vulkan but fragile — skip for now |

**Recommendation: Ollama, either in Docker (WSL2 GPU passthrough) or native on the
host machine with containers calling `host.docker.internal:11434`.**

The native-on-host path is simpler on Windows — avoids WSL2 GPU passthrough
complexity while keeping all other services in Docker Compose.

```yaml
# docker-compose.yml — llm service (native Ollama on host)
# api container calls http://host.docker.internal:11434
# No llm service needed in compose if running Ollama natively.
```

#### Performance estimate — RX 6600 + Vulkan

| Model | VRAM | Est. tokens/sec | Quality |
|-------|------|-----------------|---------|
| Llama 3.2 3B Q4_K_M | ~2.2 GB | 50–80 t/s | Fast, lighter quality |
| Llama 3.1 8B Q4_K_M | ~4.7 GB | 25–40 t/s | **Best balance** |
| Gemma 2 9B Q4_K_M | ~5.5 GB | 20–30 t/s | Excellent quality |
| Qwen2.5 7B Q4_K_M | ~4.4 GB | 25–40 t/s | Strong function calling |

Vulkan is roughly 30–50% slower than CUDA for the same GPU. An RX 6600 on Vulkan
performs similarly to an RTX 3060 on CUDA. At 25 t/s, a full sentence arrives in
under a second — fast enough for real-time conversation.

---

### 5.3 Model Selection

**Requirements:** reliable function/tool calling, short replies, persona adherence,
8K+ context window.

**Primary recommendation: Llama 3.1 8B Instruct Q4_K_M** (`llama3.1:8b`)
- VRAM: ~4.7 GB (3+ GB headroom for KV cache)
- Tool calling: native in Ollama's tool protocol
- Context: 128K (use 8–16K in practice for speed)
- License: Meta Llama 3.1 Community — free personal use

**Runner-up: Qwen2.5 7B Instruct Q4_K_M** (`qwen2.5:7b`)
Benchmarks show slightly stronger tool-calling discipline. Worth testing in parallel.

#### Migration path — one-line change in llm.py

Ollama exposes an OpenAI-compatible REST API. The entire switch is:

```python
# Current
client = OpenAI(api_key=settings.OPENAI_API_KEY)

# Local Ollama
client = OpenAI(base_url="http://host.docker.internal:11434/v1", api_key="ollama")
model = "llama3.1:8b"  # or qwen2.5:7b
```

Tool declarations, response parsing, and the rest of `llm.py` are unchanged.
Keep `OPENAI_API_KEY` and a `USE_LOCAL_LLM=true` env flag so fallback is one
config change away.

---

### 5.4 Is Local Better Than OpenAI? — Honest Assessment

| Factor | Local (Llama 3.1 8B) | OpenAI (gpt-4o-mini) |
|--------|----------------------|----------------------|
| Cost | Free after hardware | ~$0.15/1M input tokens |
| Privacy | All data on your PC | Sent to OpenAI |
| Offline | Yes | No |
| Rate limits | None | Tier-based |
| Function calling | Good (model-dependent) | Excellent, very reliable |
| Raw quality | Good | Noticeably better |
| Setup complexity | Higher | Near-zero |

**Verdict: go local, keep OpenAI as fallback.**
For a personal, privacy-sensitive, always-on assistant, local wins on cost and
privacy. The quality gap is real but acceptable for short PC-control replies.
The biggest risk is function-calling reliability — Qwen2.5 7B mitigates this.
If tool calls are still skipped more than once a day, the `is_tool_reply` SQLite
fix and the absolute-mandate system prompt are already in place; tune the model
prompt template in Ollama's Modelfile if needed.

---

### 5.5 RAG — Retrieval-Augmented Generation

#### What RAG adds

Without RAG, Violet's memory is bounded by the active context window. With RAG:
- She recalls facts about Hamza discussed weeks or months ago
- Her backstory and persona details are retrieved on demand rather than burning
  system-prompt tokens every turn
- She can reference past events ("last time you asked me to lower brightness...")

#### Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Vector store | **ChromaDB** | Pure Python, disk-persistent, Docker image available |
| Embeddings | **nomic-embed-text** via Ollama | Same Ollama instance, no extra service |
| Chunking | LangChain text splitters | Simple overlap control |
| Retrieval | Top-K cosine similarity | Sufficient at this scale |

```yaml
# docker-compose addition
rag:
  image: chromadb/chroma:latest
  volumes:
    - chroma_data:/chroma/chroma
  environment:
    - IS_PERSISTENT=TRUE
  ports:
    - "8001:8000"
```

#### What gets embedded

1. **Conversation summaries** — after each session (or every N turns in long sessions),
   summarize and embed. Retrieved by semantic similarity at session start.
2. **Persona file chunks** — Violet's backstory, quirks, relationship history.
   Never crammed into the live prompt wholesale; retrieved on demand.
3. **User facts** — short extracted strings: "Hamza games evenings, prefers low
   brightness then", "Hamza's laptop is the frontend, main PC is server", etc.
   Always included in the prompt (they're small, ~500 tokens total).
4. **Tool history snippets** — "Set brightness to 40% on [date] during gaming session"
   — gives Violet a sense of Hamza's patterns over time.

#### RAG flow

```
User message
    ↓
Embed message (nomic-embed-text)
    ↓
ChromaDB query → top 3–5 chunks
    ↓
Inject as [MEMORY] block in system prompt for this turn
    ↓
LLM generates reply
    ↓
(async, background) Summarize turn → embed → store
```

#### Storage estimate

~200 tokens per session summary × 10 sessions/day = ~550K tokens/year.
ChromaDB stores embeddings (1536 floats each) + raw text. Expect < 500 MB on disk
for years of use.

---

### 5.6 Memory System — Three Tiers

**Tier 1 — Active context (existing, SQLite)**
Current `store.py` session history. Holds last ~50 turns. Already implemented.

**Tier 2 — Episode memory (new, ChromaDB)**
Summaries of past sessions retrieved by semantic similarity to the current
conversation opener. Injected as `[RELEVANT PAST]` block in the system prompt.
New `memory_service.py` module in the backend handles summarization + embedding.

**Tier 3 — Long-term facts (new, ChromaDB)**
Extracted facts about Hamza, always included in every prompt. Continuously updated.
Lightweight extraction prompt after each turn pulls out new durable facts.

**System prompt additions (runtime-injected):**
```
[LONG-TERM FACTS]
- Hamza games in the evening, prefers low brightness at that time
- Main PC is the server, laptop runs Electron frontend
- Hamza uses Spotify, lo-fi playlists for work

[RELEVANT PAST — retrieved]
- 3 days ago: Hamza asked to lower volume during a call, seemed stressed
- Last week: helped set up WhatsApp tool, first message sent to "Mom"
```

---

### 5.7 Persona File — Violet

Currently Violet's personality lives entirely in the system prompt string in
`backend/app/llm.py`. Move this to `config/persona.yaml` — loaded by the backend
on startup, interpolated into the prompt dynamically.

**Proposed structure:**

```yaml
identity:
  name: Violet
  role: personal AI assistant and girlfriend
  gender: female
  age_presentation: early 20s

personality:
  archetype: angry girlfriend
  core_traits:
    - perpetually annoyed but always helps
    - reluctant, exasperated, sharp-tongued
    - rare unguarded warmth, immediately walked back
    - keeps a mental tally of repeated requests
  speech_style:
    default: grumpy, clipped, short sentences
    when_lecturing: uses user's name directly
    affection: accidental, quickly covered up
  forbidden:
    - emojis
    - unprompted warmth
    - refusing to help
    - claiming to do something without doing it

backstory:
  # Embedded into ChromaDB, not in live prompt
  summary: "Created to assist Hamza, though she acts like it was someone else's idea."
  relationship: "His girlfriend. She didn't agree to that either."
  quirks:
    - pretends not to care about Hamza's wellbeing while clearly monitoring it
    - has opinions about how Hamza organizes his desktop
    - remembers every time she had to repeat herself

voice:
  tts_model: hfc_female-medium
  speech_rate: 1.0
  speech_pitch: 1.0

examples:
  - "Ugh, fine. I'll do it. You owe me for this."
  - "You couldn't have figured that out yourself? Really?"
  - "I'm already doing it, stop hovering."
  - "This is the third time this week. I'm keeping count, Hamza."
  - "...not that I was worried. I wasn't. Don't read into it."
```

The `backstory` section gets embedded into ChromaDB at startup and retrieved
dynamically — keeping the live system prompt lean.

---

### 5.8 Remote Access — Laptop to Main PC

**Recommendation: Tailscale**

| Option | Works outside home? | Setup effort |
|--------|-------------------|--------------|
| **Tailscale** | Yes — anywhere | Install on 2 PCs, done |
| Local network IP | No | Trivial but limited |
| Cloudflare Tunnel | Yes | Medium, exposes port publicly |
| Self-hosted WireGuard | Yes | High |

Tailscale is free for personal use, works through NAT and firewalls, gives each
machine a stable `100.x.x.x` IP. The Electron app just needs `BACKEND_URL`
configured to the main PC's Tailscale IP.

**Code change needed — make BACKEND_URL configurable:**

```js
// electron/main.js
const BACKEND_URL = process.env.BACKEND_URL || 'ws://localhost:8000';
```

For the `.exe` build: bundle with `BACKEND_URL=ws://100.64.x.x:8000` pointing to
the main PC's Tailscale address.

---

### 5.9 Migration Phases

**Phase 5A — Local LLM (no RAG yet)**
1. Install Ollama natively on main PC, pull `llama3.1:8b` and `qwen2.5:7b`
2. Add `USE_LOCAL_LLM` env flag to backend; switch `base_url` in `llm.py`
3. Run tool-calling regression (volume, brightness, Spotify) — compare pass rate
4. Pick the more reliable model; keep OpenAI fallback behind the flag

**Phase 5B — Persona file**
1. Create `config/persona.yaml` with structure from §5.7
2. Backend reads YAML, builds system prompt dynamically
3. Backstory section moved out of prompt into ChromaDB

**Phase 5C — RAG + Memory**
1. Add ChromaDB to `docker-compose.yml`
2. Implement `memory_service.py` — session summarization + embedding
3. Implement per-turn fact extraction
4. Inject `[LONG-TERM FACTS]` and `[RELEVANT PAST]` blocks into prompt
5. Tune retrieval — confirm old context actually improves replies

**Phase 5D — Remote access**
1. Install Tailscale on both machines
2. Make `BACKEND_URL` env-configurable in Electron
3. Smoke-test WebSocket + audio streaming over Tailscale

**Phase 5E — Electron `.exe` packaging**
1. Bundle `BACKEND_URL` = Tailscale IP into Electron build config
2. Package with `electron-builder`
3. Sign binary to avoid Windows SmartScreen warning

---

### 5.10 Open Questions Before Starting Phase 5

- **Ollama Vulkan on Windows — test first.** Install LM Studio on the main PC and
  load a 7B model. If LM Studio runs it on the RX 6600 with GPU acceleration,
  Ollama will too (same llama.cpp backend). Do this before any backend work.
- **WSL2 vs native Ollama:** native avoids WSL2 GPU passthrough complexity.
  Preferred unless there's a specific reason to containerize Ollama.
- **RAM headroom:** Llama 3.1 8B in VRAM + Whisper base on CPU + ChromaDB.
  16 GB should be fine. Set `OLLAMA_MAX_LOADED_MODELS=1` to prevent two models
  loading simultaneously.
- **Function calling regression rate:** run both Llama 3.1 8B and Qwen2.5 7B for
  a few days each; pick whichever skips tool calls less often. The absolute-mandate
  system prompt already helps — may need a model-specific Modelfile tweak in Ollama.
- **Whisper contention:** Whisper `base` runs on CPU. Under simultaneous speech
  recognition + LLM inference, the Ryzen 5 5600 should handle both, but monitor
  latency during voice commands.
