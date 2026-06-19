# Session Log

Running checkpoint so a fresh session can resume without re-reading everything.
Most recent entry on top. Keep entries short. See ROADMAP.md for the plan;
this is what we actually did. Pairs with the memory index (MEMORY.md).

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
