# Setup

Violet has two halves that run independently:

- **Backend** — a Dockerized stack of services (LLM, speech-to-text, wake word, TTS, embeddings). Runs anywhere, reached over HTTP/WebSocket.
- **Client** — an Electron desktop overlay (the avatar + UI). Runs on your PC and talks to the backend at `localhost:8000`.

You can run the backend in dev (`docker compose`) and the client either in dev (Vite + Electron) or as a packaged `.exe`.

---

## Prerequisites

| For | Need |
|-----|------|
| Backend | [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose) |
| Client (dev) | [Node.js 18+](https://nodejs.org/) and npm |
| Building the `.exe` | Node.js 18+, and **Windows Developer Mode ON** (Settings → Privacy & security → For developers) so electron-builder can extract symlinks |
| LLM | An `OPENAI_API_KEY` (cloud), and/or a local [Ollama](https://ollama.com/) model, and/or an NVIDIA NIM key |

---

## 1. Backend

```bash
cd server/api
cp .env.example .env
# edit .env — set OPENAI_API_KEY (minimum). Optionally NVIDIA_API_KEY / LLM_PROVIDER.
```

The key env vars (`server/api/.env`):

- `OPENAI_API_KEY` — cloud LLM (required for the default `auto`/`openai` provider).
- `LLM_PROVIDER` — `auto` (local Ollama → GPT fallback), `openai`, `nvidia`, or `local`.
- `NVIDIA_API_KEY` — optional, enables the NVIDIA NIM brain.

## 2. Docker — run the backend

From the `server/` directory:

```bash
cd server
docker compose up --build          # build + start all services
```

Backend is now live:

- API / WebSocket: `http://localhost:8000` (WS at `ws://localhost:8000/chat/ws`)
- Health check: `http://localhost:8000/health`

Stop it with `Ctrl+C`, or run detached and stop later:

```bash
docker compose up --build -d       # background
docker compose down                # stop
```

**Optional — local LLM (Ollama):** only starts under the `local` profile.

```bash
docker compose --profile local up -d
docker compose --profile local exec ollama ollama pull llama3.1:8b   # first time
```

Match `LOCAL_LLM_MODEL` in `.env` to the tag you pulled.

## 3. Client — run the frontend (dev)

Install once, then start. From `client/`:

```bash
cd client/frontend
npm install

cd ../electron
npm install
npm run dev          # starts Vite + Electron together
```

`npm run dev` launches the Vite renderer (port 5173) and the Electron overlay against it. Make sure the backend (steps 1–2) is running first.

To run only the browser renderer (no Electron shell):

```bash
cd client/frontend
npm run dev          # open http://localhost:5173
```

## 4. Build & run the standalone Electron app

From `client/electron` (needs Developer Mode ON — see prerequisites):

```bash
cd client/electron
npm install
npm run dist         # builds the frontend + packages the .exe
```

Output lands in `client/dist-app/`:

- `Violet Setup 0.1.0.exe` — installer (NSIS)
- `Violet-0.1.0-portable.exe` — portable, no install

Run either one. The app is unsigned, so Windows SmartScreen may warn on first launch (More info → Run anyway).

> The `.exe` is the **client only** — it still needs the backend running (steps 1–2). It connects to `localhost:8000` by default.
