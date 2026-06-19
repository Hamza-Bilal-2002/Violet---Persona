# AI Avatar Assistant — Complete Backend Documentation

**Project:** Persona AI Avatar Assistant  
**Author:** Hamza Bilal  
**Stack:** FastAPI · Ollama · Gemini · ChromaDB · Piper TTS · Faster-Whisper · Docker  
**Purpose:** Fully local, dockerized AI assistant backend with RAG, voice, and streaming

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository & Git Structure](#2-repository--git-structure)
3. [Docker Architecture](#3-docker-architecture)
4. [Backend Service — FastAPI](#4-backend-service--fastapi)
5. [LLM Service — Multi-Provider](#5-llm-service--multi-provider)
6. [RAG System — Knowledge Base](#6-rag-system--knowledge-base)
7. [Speech Service — STT + TTS](#7-speech-service--stt--tts)
8. [WebSocket Communication](#8-websocket-communication)
9. [Frontend Serving](#9-frontend-serving)
10. [Environment Configuration](#10-environment-configuration)
11. [Data Flow — End to End](#11-data-flow--end-to-end)
12. [Performance Optimizations](#12-performance-optimizations)
13. [File-by-File Reference](#13-file-by-file-reference)
14. [Next Steps](#14-next-steps)

---

## 1. Project Overview

Persona is a fully local AI avatar assistant built for Hamza Bilal. The system is:

- **100% free** — no paid APIs required (optional Gemini/OpenAI API keys supported)
- **Fully local** — runs entirely on your own hardware via Docker
- **Docker-first** — every service runs in an isolated container
- **Streaming** — LLM responses stream token by token in real time
- **Voice-enabled** — speech-to-text input, text-to-speech output
- **RAG-powered** — reads PDF knowledge files and injects context into responses
- **Persona-driven** — hardcoded personality system prompt, RAG used only for factual knowledge

### Hardware Used During Development
- **Main PC:** Ryzen 5 3600, AMD RX 6600, 16GB RAM
- **Laptop:** HP EliteBook 840 G5, Intel i7, integrated graphics, 16GB RAM

---

## 2. Repository & Git Structure

### Initialization
```bash
git init
git branch -M main
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

### Branch Strategy
```
main          ← stable production code
dev           ← integration branch
feature/*     ← individual feature branches
bugfix/*      ← bug fix branches
```

### Branches Created During Development
- `feature/rag-system` — PDF RAG pipeline
- `feature/docker-setup` — full Docker containerization
- `feature/performance` — RAG skipping optimization, Ollama keepalive
- `feature/llm-provider-switch` — multi-provider LLM support
- `feature/voice-system` — Faster-Whisper STT
- `feature/tts-voice` — Piper TTS synthesis
- `feature/threejs-avatar` — Three.js avatar frontend

### .gitignore Key Entries
```
__pycache__/
.venv/
.env           # never commit secrets
volumes/       # Docker persistent data excluded
frontend/godot/.godot/
*.log
```

---

## 3. Docker Architecture

### Overview
All services run as Docker containers connected via a shared internal network `avatar_net`. The host machine only exposes necessary ports.

### docker-compose.yml
```yaml
services:
  backend:        # FastAPI — port 8000
  chromadb:       # Vector database — port 8001
  ollama:         # Local LLM runtime — port 11434
  speech-service: # STT + TTS — port 8002

networks:
  avatar_net:
    driver: bridge
```

### Container Details

#### backend (avatar_backend)
- **Image:** Built from `./backend/Dockerfile`
- **Base:** `python:3.11-slim`
- **Port:** `8000:8000`
- **Volumes:**
  - `./backend:/app` — live code reload
  - `./backend/data:/app/data` — PDF knowledge files
  - `./frontend/web:/app/frontend` — serves frontend statically
- **Dependencies:** chromadb must start first

#### chromadb (avatar_chromadb)
- **Image:** `chromadb/chroma:latest` (v1.5.9)
- **Port:** `8001:8000`
- **Volume:** `./volumes/chromadb:/chroma/chroma` — persistent vector storage
- **Purpose:** Stores text embeddings for RAG retrieval

#### ollama (avatar_ollama)
- **Image:** `ollama/ollama:latest`
- **Port:** `11434:11434`
- **Volume:** `./volumes/ollama:/root/.ollama` — persists downloaded models
- **Model Used:** `llama3.2:1b` (laptop), upgrade to `llama3:8b` on main PC
- **Note:** Model must be pulled manually after first start:
  ```bash
  docker exec -it avatar_ollama ollama pull llama3.2:1b
  ```

#### speech-service (avatar_speech)
- **Image:** Built from `./speech-service/Dockerfile`
- **Base:** `python:3.11-slim`
- **Port:** `8002:8002`
- **Volumes:**
  - `./speech-service:/app` — live code reload
  - `./volumes/piper:/app/voices` — Piper voice model files
- **Whisper model:** Pre-downloaded at Docker build time

### Volume Structure
```
volumes/
├── chromadb/    ← ChromaDB persistent vector data
├── ollama/      ← Ollama downloaded LLM model weights
├── sqlite/      ← SQLite conversation history (future)
└── piper/       ← Piper TTS voice model files (.onnx + .json)
```

### Piper Voice Files
Downloaded manually before first Docker run:
```bash
cd volumes/piper
curl -L -o en_US-lessac-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
curl -L -o en_US-lessac-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
```

### Docker Commands Reference
```bash
docker compose up --build        # build and start all containers
docker compose up -d             # start in detached mode
docker compose down              # stop all containers
docker compose logs -f           # stream all logs
docker ps                        # list running containers
docker exec -it avatar_ollama ollama list   # check downloaded models
```

---

## 4. Backend Service — FastAPI

### Location: `backend/`

### Dockerfile
```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc libffi-dev
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```
- Uses `--reload` for hot reload during development
- `gcc` and `libffi-dev` needed for compiling some Python packages

### requirements.txt
Key libraries:
```
fastapi==0.111.0          # web framework
uvicorn[standard]==0.30.1 # ASGI server
websockets==12.0          # WebSocket support
python-multipart==0.0.9   # file upload handling
ollama==0.3.3             # Ollama Python client
langchain==0.2.6          # RAG pipeline
langchain-community==0.2.6
langchain-ollama==0.1.1
chromadb>=1.0.0           # vector database client
sentence-transformers==3.0.1  # text embedding model
pymupdf==1.24.5           # PDF text extraction (primary)
pdfplumber==0.11.1        # PDF text extraction (fallback)
sqlalchemy==2.0.31        # ORM (future use)
aiosqlite==0.20.0         # async SQLite
python-dotenv==1.0.1      # .env file loading
pydantic==2.7.4           # data validation
pydantic-settings==2.3.4  # settings from env vars
httpx==0.27.0             # async HTTP client (TTS requests)
aiofiles==23.2.1          # async file handling
loguru==0.7.2             # structured logging
tqdm==4.66.4              # progress bars
google-generativeai==0.8.3  # Gemini API client
openai==1.35.0            # OpenAI API client (future)
```

### app/main.py
The FastAPI application entry point.

**Responsibilities:**
- Creates the FastAPI app instance
- Configures CORS middleware (allows all origins for local dev)
- Registers all routers
- Runs `load_knowledge()` on startup via lifespan context manager
- Starts the Ollama keepalive background task
- Serves the frontend statically via `StaticFiles`

**Key implementation:**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting...")
    load_knowledge()              # load PDFs into ChromaDB
    asyncio.create_task(keepalive_loop())  # keep Ollama warm
    yield
    logger.info("Shutting down...")
```

**Routes:**
- `GET /` — health check
- `GET /health` — health check
- `GET /ui` — serves `index.html` (chat UI)
- `GET /avatar` — serves `avatar.html` (3D avatar)
- `WS /chat/ws` — main WebSocket for all AI interaction
- `GET /chat/ping` — REST ping for chat router

### app/core/config.py
Uses `pydantic-settings` to load configuration from environment variables with fallback defaults.

```python
class Settings(BaseSettings):
    LLM_PROVIDER: str        # "ollama", "gemini", or "openai"
    OLLAMA_BASE_URL: str     # http://ollama:11434 in Docker
    OLLAMA_MODEL: str        # llama3.2:1b
    GEMINI_API_KEY: str
    GEMINI_MODEL: str        # gemini-2.5-flash
    CHROMA_HOST: str         # "chromadb" in Docker, "localhost" outside
    CHROMA_PORT: int         # 8000 inside Docker network
    SPEECH_SERVICE_URL: str  # http://speech-service:8002
```

**Important:** Inside Docker, services talk to each other using container names as hostnames (`chromadb`, `ollama`, `speech-service`), not `localhost`.

---

## 5. LLM Service — Multi-Provider

### Location: `backend/app/services/llm.py`

### Purpose
Routes LLM requests to the correct provider based on `LLM_PROVIDER` environment variable. Supports Ollama (local), Gemini (cloud), and OpenAI (cloud).

### Hardcoded System Prompt
Persona's identity is hardcoded directly in the system prompt — not loaded from PDF — because it never changes:

```python
SYSTEM_PROMPT = """You are Persona, a highly intelligent personal AI assistant 
created exclusively for Hamza Bilal, the world's biggest CEO.
You are female, warm, loving, sweet, caring, calm and supportive...
Always address the user as Hamza."""
```

### Smart RAG Decision
Before every message, the system decides whether to query the knowledge base. Casual messages skip RAG entirely to save latency:

```python
CASUAL_TRIGGERS = ["hi", "hello", "hey", "thanks", "ok", ...]

def needs_rag(message: str) -> bool:
    msg = message.lower().strip()
    if len(msg) < 10: return False
    if msg in CASUAL_TRIGGERS: return False
    
    question_signals = ["what", "how", "when", "stats", "explain", ...]
    for signal in question_signals:
        if signal in msg: return True
    return False
```

### Provider Implementations

#### Ollama (Local)
```python
async def stream_ollama(message, history, system_prompt):
    client = AsyncClient(host=OLLAMA_HOST)
    async for chunk in await client.chat(
        model=OLLAMA_MODEL,
        messages=messages,
        stream=True
    ):
        yield chunk["message"]["content"]
```
- Uses the official `ollama` Python library
- Streams tokens as they are generated
- Connects to `http://ollama:11434` inside Docker

#### Gemini (Cloud)
```python
async def stream_gemini(message, history, system_prompt):
    genai.configure(api_key=GEMINI_KEY)
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=system_prompt
    )
    chat = model.start_chat(history=gemini_history)
    response = chat.send_message(message, stream=True)
    for chunk in response:
        yield chunk.text
```
- Uses `google-generativeai` library
- Converts conversation history to Gemini format
- Current model: `gemini-2.5-flash` (not preview — that was deprecated)

#### OpenAI (Future)
```python
async def stream_openai(message, history, system_prompt):
    client = AsyncOpenAI(api_key=OPENAI_KEY)
    stream = await client.chat.completions.create(
        model=OPENAI_MODEL, messages=messages, stream=True
    )
    async for chunk in stream:
        yield chunk.choices[0].delta.content
```

### Switching Providers
Change one line in `.env` and restart:
```
LLM_PROVIDER=ollama    # local, free
LLM_PROVIDER=gemini    # cloud, fast, free tier
LLM_PROVIDER=openai    # cloud, paid
```

### Keepalive Service
`backend/app/services/keepalive.py` — pings Ollama every 3 minutes to keep the model loaded in memory, preventing the cold-start delay on first message:

```python
async def keepalive_loop():
    await asyncio.sleep(30)  # wait for startup
    while True:
        await client.post(f"{OLLAMA_HOST}/api/generate",
            json={"model": MODEL, "prompt": "", "keep_alive": "10m"})
        await asyncio.sleep(180)  # every 3 minutes
```

---

## 6. RAG System — Knowledge Base

### Location: `backend/app/rag/rag.py`

### Purpose
Stores factual knowledge in ChromaDB as vector embeddings. When a user asks a relevant question, the most similar knowledge chunks are retrieved and injected into the LLM prompt as context.

### Architecture
```
PDF files in backend/data/
    ↓ PyMuPDF extracts text
    ↓ LangChain splits into 500-char chunks
    ↓ sentence-transformers embeds each chunk
    ↓ ChromaDB stores vectors
    
User question
    ↓ sentence-transformers embeds question
    ↓ ChromaDB cosine similarity search
    ↓ Top 3 most relevant chunks returned
    ↓ Injected into LLM system prompt as context
```

### Key Design Decisions

**1. Lazy initialization** — ChromaDB client is created only when first needed, not at import time. This prevents startup crashes if ChromaDB isn't ready yet:
```python
_chroma_client = None
def get_chroma_client():
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.HttpClient(host=chroma_host, port=chroma_port)
    return _chroma_client
```

**2. Auto-load at startup** — `load_knowledge()` is called in `main.py` lifespan. It scans `backend/data/` and ingests every `.pdf` file automatically. Adding new knowledge = drop a PDF in the folder and restart.

**3. Wipe and reload** — On every startup, the old ChromaDB collection is deleted and rebuilt fresh. This ensures edits to knowledge PDFs take effect immediately.

**4. Dual PDF parser** — PyMuPDF is tried first (faster, better for most PDFs). If it fails or returns empty text, pdfplumber is used as fallback.

### Embedding Model
```python
from sentence_transformers import SentenceTransformer
_embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
```
- `all-MiniLM-L6-v2` — lightweight, fast, good quality embeddings
- 384-dimensional vectors
- Runs locally, no API needed

### Text Chunking
```python
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", ".", " "]
)
```
- 500 characters per chunk with 50-character overlap
- Overlap ensures context isn't lost at chunk boundaries

### ChromaDB Collection
```python
collection = client.get_or_create_collection(
    name="knowledge",
    metadata={"hnsw:space": "cosine"}  # cosine similarity search
)
```

### Knowledge Files
Location: `backend/data/`
- `company-stats.pdf` — factual data about Hamza's company, statistics, etc.
- Add any PDF here and restart Docker to include it in the knowledge base

### Separation of Concerns
- **Persona behavior** → hardcoded in system prompt in `llm.py`
- **Factual knowledge** → PDF files in `backend/data/` loaded via RAG
- This means personality never needs to change, only facts get updated via PDFs

---

## 7. Speech Service — STT + TTS

### Location: `speech-service/`

### Dockerfile
```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get install -y gcc ffmpeg libsndfile1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Pre-download Whisper model at build time
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')"
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]
```
- `ffmpeg` required for audio processing
- `libsndfile1` required for audio file reading
- Whisper model downloaded during Docker build so it's ready instantly on startup

### requirements.txt
```
fastapi==0.111.0
uvicorn[standard]==0.30.1
faster-whisper==1.0.3     # Speech-to-Text
piper-tts==1.2.0          # Text-to-Speech
python-multipart==0.0.9   # audio file upload
requests==2.31.0          # HTTP client
numpy==1.26.4             # audio processing
aiofiles==23.2.1
loguru==0.7.2
```

### app/main.py — Speech to Text (STT)
**Library:** `faster-whisper` — optimized Whisper implementation, runs on CPU with int8 quantization

**Model:** `tiny` on laptop (fast, ~75MB), upgrade to `base` on main PC

**Endpoint:** `POST /transcribe`

```python
whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")

@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    # Save webm audio to temp file
    with tempfile.NamedTemporaryFile(suffix=".webm") as tmp:
        tmp.write(await audio.read())
    
    # Transcribe with VAD (voice activity detection) filtering
    segments, info = whisper_model.transcribe(
        tmp_path,
        beam_size=3,
        language="en",
        vad_filter=True,              # removes silence automatically
        vad_parameters=dict(min_silence_duration_ms=300)
    )
    
    text = " ".join([seg.text.strip() for seg in segments])
    return {"text": text, "empty": not text}
```

**VAD filter** — `vad_filter=True` uses Silero VAD to automatically detect and remove silent segments, improving transcription accuracy.

### app/main.py — Text to Speech (TTS)
**Library:** `piper-tts` — fast, local, neural TTS

**Voice:** `en_US-lessac-medium` — clear, natural female English voice

**Voice files location:** `/app/voices/` (mounted from `./volumes/piper/`)

**Endpoint:** `POST /speak`

```python
piper_voice = PiperVoice.load("/app/voices/en_US-lessac-medium.onnx")

@app.post("/speak")
async def speak(payload: dict):
    text = payload.get("text", "")
    
    # Synthesize directly to WAV in memory
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wav_file:
        piper_voice.synthesize(text, wav_file)
    
    wav_buffer.seek(0)
    return StreamingResponse(wav_buffer, media_type="audio/wav")
```

- Synthesizes to an in-memory WAV buffer (no disk writes)
- Returns as streaming HTTP response
- Frontend plays the WAV audio automatically

### CORS
Speech service has full CORS middleware allowing requests from any origin — necessary since the frontend and speech service run on different ports.

---

## 8. WebSocket Communication

### Location: `backend/app/api/chat.py`

### Purpose
The WebSocket endpoint at `/chat/ws` is the single connection point for all AI interaction. It handles:
1. Receiving user text messages
2. Streaming LLM response tokens
3. Requesting TTS audio from speech service
4. Sending audio bytes back to client
5. Maintaining per-session conversation history

### Protocol
Messages sent between backend and frontend follow this protocol:

**Backend → Frontend (text frames):**
```
"__START__"         # signals start of LLM response stream
"token token ..."   # individual tokens streamed as they arrive
"__END__"           # signals end of LLM response stream
```

**Backend → Frontend (binary frames):**
```
b"__AUDIO_START__"  # signals audio is coming
<WAV bytes>         # raw WAV audio data
b"__AUDIO_END__"    # signals end of audio
```

**Frontend → Backend:**
```
"user message text"  # plain text user message
```

### Implementation

```python
@router.websocket("/ws")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    history = []  # conversation memory per session

    while True:
        user_message = await websocket.receive_text()

        # 1. Stream text response
        await websocket.send_text("__START__")
        full_response = ""
        async for token in stream_chat(user_message, history):
            full_response += token
            await websocket.send_text(token)
        await websocket.send_text("__END__")

        # 2. Update conversation history
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": full_response})
        if len(history) > 20:
            history = history[-20:]  # keep last 10 exchanges

        # 3. Request TTS and stream audio
        audio_bytes = await request_tts(full_response)
        if audio_bytes:
            await websocket.send_bytes(b"__AUDIO_START__")
            await websocket.send_bytes(audio_bytes)
            await websocket.send_bytes(b"__AUDIO_END__")
```

### TTS Request
```python
async def request_tts(text: str) -> bytes | None:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{SPEECH_SERVICE_URL}/speak",
            json={"text": text}
        )
        return response.content if response.status_code == 200 else None
```
- Uses `httpx` async client to call speech-service container
- 30 second timeout to handle long responses
- Returns None if TTS fails — chat still works without audio

### Conversation Memory
- Each WebSocket connection gets its own `history` list
- History is kept in memory (lost when connection closes)
- Limited to last 20 messages (10 exchanges) to prevent context overflow
- Future improvement: persist history to SQLite

---

## 9. Frontend Serving

### Location: `backend/app/main.py`

The backend serves the frontend statically, eliminating all CORS issues by making everything run from the same origin:

```python
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Mount frontend folder as static files
app.mount("/static", StaticFiles(directory="/app/frontend"), name="static")

# Serve chat UI
@app.get("/ui")
async def serve_ui():
    return FileResponse("/app/frontend/index.html")

# Serve avatar page
@app.get("/avatar")
async def serve_avatar():
    return FileResponse("/app/frontend/avatar.html")
```

The `./frontend/web` directory is mounted into the backend container at `/app/frontend` via docker-compose volume. This means frontend changes are reflected immediately without rebuilding.

### Access URLs
- Chat UI: `http://localhost:8000/ui`
- Avatar: `http://localhost:8000/avatar`
- API docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/health`

---

## 10. Environment Configuration

### .env (never commit this file)
```env
# App
APP_NAME=AI Avatar Assistant
DEBUG=true
SECRET_KEY=changeme

# LLM Provider — options: ollama, gemini, openai
LLM_PROVIDER=gemini

# Ollama — container name inside Docker
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:1b

# Gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash

# OpenAI (future)
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini

# ChromaDB — container name inside Docker
CHROMA_HOST=chromadb
CHROMA_PORT=8000

# Speech Service — container name inside Docker
SPEECH_SERVICE_URL=http://speech-service:8002

# Whisper
WHISPER_MODEL=tiny

# Piper
PIPER_VOICE=en_US-lessac-medium
```

### .env.example (safe to commit)
Same structure but with placeholder values — committed to git so other developers know what variables are needed.

### Important Note on Docker Networking
Inside Docker containers, services communicate via container names:
- `chromadb` not `localhost:8001`
- `ollama` not `localhost:11434`
- `speech-service` not `localhost:8002`

Outside Docker (running locally), use `localhost` with the exposed ports.

---

## 11. Data Flow — End to End

### Text Message Flow
```
1. User types message in browser
2. Frontend sends text over WebSocket to backend:8000/chat/ws
3. backend/app/api/chat.py receives message
4. backend/app/services/llm.py checks if RAG is needed
5. If needed: backend/app/rag/rag.py queries ChromaDB
   - Embeds question with sentence-transformers
   - ChromaDB returns top 3 similar knowledge chunks
   - Chunks injected into system prompt
6. LLM provider called with full prompt + history
   - Ollama: streams from http://ollama:11434
   - Gemini: streams from Google API
7. Tokens streamed back to frontend via WebSocket
   - Frontend shows "__START__" → starts new bubble
   - Each token appended to bubble in real time
   - "__END__" → bubble complete
8. Full response text sent to speech-service:8002/speak
9. Piper TTS synthesizes WAV audio
10. WAV bytes sent back to backend via httpx
11. Backend sends binary frames to frontend:
    - b"__AUDIO_START__"
    - <WAV bytes>
    - b"__AUDIO_END__"
12. Frontend plays audio automatically
```

### Voice Input Flow
```
1. User holds mic button in browser
2. Browser records audio using MediaRecorder API (webm format)
3. On release: audio blob sent to backend:8000 → forwarded to speech-service:8002/transcribe
4. Faster-Whisper transcribes audio to text
5. Transcribed text returned to frontend
6. Frontend displays transcription and sends it as a text message
7. Continue with Text Message Flow above
```

---

## 12. Performance Optimizations

### 1. Smart RAG Skipping
Casual messages (under 10 chars, greetings, simple responses) skip the RAG pipeline entirely. This saves ~500ms-1s per casual message by avoiding the embedding + ChromaDB query.

### 2. Ollama Keepalive
Background task pings Ollama every 3 minutes with `keep_alive: 10m`. This keeps the model loaded in GPU/CPU memory, eliminating the ~15-20 second cold-start delay on the first message.

### 3. Lazy ChromaDB Initialization
ChromaDB client created only on first use, not at import time. Prevents startup race conditions when the ChromaDB container is still initializing.

### 4. In-Memory TTS
Piper synthesizes directly to a `BytesIO` buffer — no disk writes. Reduces I/O overhead significantly.

### 5. Connection Pooling
`httpx.AsyncClient` used for TTS requests — async, non-blocking, doesn't hold up the WebSocket while waiting for audio synthesis.

### Planned Optimizations (Not Yet Implemented)
- **Sentence-level streaming** — process and speak sentence by sentence instead of waiting for full response
- **Parallel TTS** — synthesize sentence 1 while sentence 2 is being generated
- **Rhubarb Lip Sync** — generate viseme timestamps from WAV for accurate lip sync
- **Kokoro TTS** — higher quality, more emotional voice synthesis

---

## 13. File-by-File Reference

### Backend (`backend/`)

| File | Purpose |
|---|---|
| `Dockerfile` | Container build instructions, Python 3.11-slim base |
| `requirements.txt` | All Python dependencies with pinned versions |
| `app/main.py` | FastAPI app, lifespan, CORS, routers, static files |
| `app/core/config.py` | Pydantic settings from environment variables |
| `app/api/chat.py` | WebSocket handler, TTS request, conversation history |
| `app/services/llm.py` | Multi-provider LLM streaming, RAG decision, system prompt |
| `app/services/keepalive.py` | Ollama keepalive background task |
| `app/rag/rag.py` | PDF ingestion, ChromaDB storage, vector search, lazy init |
| `app/models/__init__.py` | Placeholder for future SQLAlchemy models |
| `app/voice/__init__.py` | Placeholder for future voice utilities |
| `data/company-stats.pdf` | Knowledge base PDF — factual data for RAG |

### Speech Service (`speech-service/`)

| File | Purpose |
|---|---|
| `Dockerfile` | Container build, ffmpeg, libsndfile1, Whisper pre-download |
| `requirements.txt` | faster-whisper, piper-tts, fastapi dependencies |
| `app/main.py` | FastAPI app, STT endpoint, TTS endpoint, CORS |

### Root

| File | Purpose |
|---|---|
| `docker-compose.yml` | All 4 containers, networking, volumes |
| `.env` | Secret config — never commit |
| `.env.example` | Template for .env — safe to commit |
| `.gitignore` | Excludes .env, volumes, __pycache__, .venv |

---

## 14. Next Steps

These are the features planned but not yet implemented:

### Immediate
1. **Sentence streaming pipeline** — process TTS per sentence for lower perceived latency
2. **Emotion detection** — analyze LLM response and return emotion tag with each message
3. **Avatar state JSON** — backend sends structured payload:
   ```json
   {
     "text": "Hello Hamza!",
     "emotion": "happy",
     "animation": "talking",
     "audio": "<base64 or URL>",
     "visemes": [
       { "t": 0.0, "v": "aa" },
       { "t": 0.1, "v": "oh" }
     ]
   }
   ```
4. **Rhubarb Lip Sync** — add Rhubarb executable to speech-service container, generate visemes from WAV

### Medium Term
5. **Tailscale remote access** — expose server securely to laptop and other devices
6. **Conversation persistence** — save history to SQLite so sessions are remembered
7. **Kokoro TTS upgrade** — replace Piper with Kokoro for more emotional voice
8. **Upgrade to llama3:8b** — on main PC with RX 6600, much better response quality

### Long Term
9. **Electron app packaging** — wrap Three.js frontend as Windows .exe
10. **Android APK** — mobile client connecting to same backend over Tailscale
11. **Multi-user support** — separate conversation histories per user
12. **Webcam emotion detection** — detect Hamza's facial expressions and respond accordingly

---

## Notes for Continuing Development

### Running Locally (Outside Docker)
```bash
cd backend
/c/Program\ Files/Python311/python.exe -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### Important: ChromaDB Version
The ChromaDB Python client must be `>=1.0.0`. Older versions use the deprecated v1 API which the latest ChromaDB server no longer supports.

### Important: Gemini Model Name
Use `gemini-2.5-flash` — not `gemini-2.5-flash-preview-04-17` (deprecated). The preview suffix was removed when the model went stable.

### Important: Docker Internal Networking
When adding new service-to-service calls, always use container names (e.g. `http://speech-service:8002`) not localhost. Localhost inside a container refers to that container only.
