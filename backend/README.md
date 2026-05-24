# Persona Backend

FastAPI service that talks to OpenAI (gpt-4o-mini by default) with
function calling and pushes structured replies (text + emotion +
animation hints) plus tool_call frames to the frontend over a
WebSocket.

## Bring up

```bash
cd backend
cp .env.example .env
# edit .env and set OPENAI_API_KEY (optionally OPENAI_MODEL)
```

From the project root:

```bash
docker compose up --build
```

The API will be available at `http://localhost:8000`.

- Health: `GET /health` — should return `{"status":"ok","llm_configured":true,...}`
- WebSocket: `ws://localhost:8000/chat/ws`

## Protocol

**Client → Server** (text frames):

```
{"text": "Hi Persona"}
```

Plain text also accepted for quick testing.

**Server → Client** (text frames):

```json
{
  "type": "reply",
  "text": "Hi Hamza, good to see you.",
  "emotion": {"name": "happy", "intensity": 0.5},
  "animation": "waving"
}
```

Error frames look like:

```json
{"type": "error", "message": "LLM error: ..."}
```

## What's NOT here yet

- Piper TTS (frontend uses browser TTS for MVP — swap planned)
- Ollama / local LLM (OpenAI cloud only)
- ChromaDB / RAG knowledge base
- Whisper STT lives in the speech/ container, not here

## File layout

```
backend/
├── Dockerfile
├── requirements.txt
├── .env.example
├── .dockerignore
├── README.md
└── app/
    ├── __init__.py
    ├── main.py        # FastAPI app, /health, /chat/ws
    ├── config.py      # pydantic-settings, loads .env
    ├── llm.py         # OpenAI client + system prompt + chat session
    ├── tools.py       # function-call schemas for Phase 3
    └── protocol.py    # emotion/animation tag parser
```
