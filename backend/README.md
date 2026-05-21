# Persona Backend

FastAPI service that talks to Gemini 2.5 Flash and pushes structured
replies (text + emotion + animation hints) to the frontend over a
WebSocket.

## Bring up

```bash
cd backend
cp .env.example .env
# edit .env and set GEMINI_API_KEY
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
- Ollama / local LLM (Gemini cloud only for MVP)
- ChromaDB / RAG knowledge base
- Whisper STT (voice input)

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
    ├── llm.py         # Gemini client + system prompt
    └── protocol.py    # emotion/animation tag parser
```
