"""
FastAPI entry point.

One WebSocket route at /chat/ws that handles the full dialogue loop:
1. receive user message (text)
2. call Gemini with conversation history
3. parse emotion/animation tags out of the reply
4. send structured reply frame back to client
5. append both turns to per-connection history
"""

from __future__ import annotations

import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .config import settings
from .llm import client as llm_client
from .protocol import parse_reply


app = FastAPI(title=f"{settings.agent_name} Avatar Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"name": f"{settings.agent_name.lower()}-backend", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "llm_configured": bool(settings.GEMINI_API_KEY),
        "model": settings.GEMINI_MODEL,
    }


@app.websocket("/chat/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    logger.info("client connected")

    history: list[dict] = []

    try:
        while True:
            raw = await websocket.receive_text()

            # accept either {"text": "..."} JSON OR plain text
            user_text = raw
            try:
                obj = json.loads(raw)
                if isinstance(obj, dict) and "text" in obj:
                    user_text = obj["text"]
            except json.JSONDecodeError:
                pass

            user_text = (user_text or "").strip()
            if not user_text:
                continue

            logger.info(f"user: {user_text}")

            try:
                raw_reply = llm_client.reply(user_text, history)
            except Exception as e:
                logger.exception("LLM call failed")
                await websocket.send_text(
                    json.dumps({
                        "type": "error",
                        "message": f"LLM error: {e}",
                    })
                )
                continue

            parsed = parse_reply(raw_reply)
            logger.info(
                f"{settings.agent_name} ({parsed.emotion_name}@{parsed.emotion_intensity:.2f}, "
                f"{parsed.animation}): {parsed.text}"
            )

            await websocket.send_text(json.dumps(parsed.to_dict()))

            # update history with the FULL raw reply so the model
            # sees its own prior tag formatting and stays consistent.
            history.append({"role": "user", "content": user_text})
            history.append({"role": "assistant", "content": raw_reply})

            # cap history at last 20 turns to avoid token bloat
            if len(history) > 20:
                history = history[-20:]

    except WebSocketDisconnect:
        logger.info("client disconnected")
    except Exception:
        logger.exception("websocket loop crashed")
