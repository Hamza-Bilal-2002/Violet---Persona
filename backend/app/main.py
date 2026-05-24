"""
FastAPI entry point.

One WebSocket route at /chat/ws drives the full dialogue loop. Each
user message can fan out into a multi-step exchange with Gemini if
the model decides to call a tool:

  1. receive user text frame
  2. send to Gemini, get back text OR function_call(s)
  3. if function_calls: emit tool_call frames to the client, await
     matching tool_result frames, send the results back to Gemini,
     repeat from (2)
  4. once Gemini returns text, parse the inline emotion/animation
     tags and send the structured reply frame to the client
  5. append the user turn + the final text reply to per-connection
     history (we don't preserve the intermediate tool exchanges —
     the final text usually summarizes what happened anyway)

Frame shapes:

  client -> server:
    "plain text"                                    (legacy text)
    {"text": "..."}                                 (preferred)
    {"type": "tool_result", "id": "...",
     "result": {...}}                               (success)
    {"type": "tool_result", "id": "...",
     "error": "..."}                                (failure)

  server -> client:
    {"type": "reply", "text": "...",
     "emotion": {"name": "...", "intensity": ...},
     "animation": "..."}
    {"type": "tool_call", "id": "...",
     "name": "...", "args": {...}}
    {"type": "error", "message": "..."}
"""

from __future__ import annotations

import asyncio
import json
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .config import settings
from .llm import client as llm_client
from .protocol import parse_reply


# Tools should resolve quickly — open_url is effectively instant,
# system calls take a second at most. If a tool hangs past this,
# we tell Gemini it failed and continue. Bump if Wave 3.3 tools
# (Spotify, Calendar) need longer.

TOOL_TIMEOUT_SECONDS = 30.0

# Cap how many tool-call rounds Gemini can request before we bail.
# Protects against accidental loops where the model keeps calling
# tools without ever emitting text. Real conversations should
# resolve in 1-2 rounds.

MAX_TOOL_ROUNDS = 5

# Cap how many Content entries we keep in the chat session's
# accumulated history. Each user turn typically adds 2-4 entries
# (user msg, optional function_call, optional function_response,
# assistant text). 60 entries ~ 15-30 turns, enough for any
# practical session without bloating the token bill.

MAX_HISTORY_ENTRIES = 60


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
        "llm_configured": bool(settings.OPENAI_API_KEY),
        "model": settings.OPENAI_MODEL,
    }


@app.websocket("/chat/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    logger.info("client connected")

    # One Gemini chat session per WebSocket. The session owns its
    # full history — user messages, function_calls, function_responses,
    # and assistant text — so multi-turn function-calling stays
    # coherent. Rebuilding from a text-only history list per turn
    # made the model forget that tools had been called, which
    # produced "the site is already open" hallucinations on the
    # second open-X request in a session.

    try:
        session = llm_client.create_session()
    except Exception as e:
        logger.exception("could not create Gemini chat session")
        await websocket.send_text(
            json.dumps({"type": "error", "message": f"LLM init failed: {e}"})
        )
        await websocket.close()
        return

    try:
        while True:
            raw = await websocket.receive_text()

            user_text = _parse_user_frame(raw)
            if not user_text:
                continue

            logger.info(f"user: {user_text}")

            try:
                final_text = await _run_dialogue_turn(
                    websocket, session, user_text
                )
            except Exception as e:
                logger.exception("dialogue turn failed")
                await websocket.send_text(
                    json.dumps({
                        "type": "error",
                        "message": f"LLM error: {e}",
                    })
                )
                continue

            if not final_text:
                # Gemini produced only tool calls and no text. Shouldn't
                # happen with our system prompt but be defensive — emit
                # a generic confirmation so the user gets some signal.
                logger.warning("dialogue turn produced no final text; using fallback")
                final_text = "Done."

            parsed = parse_reply(final_text)
            logger.info(
                f"{settings.agent_name} ({parsed.emotion_name}@{parsed.emotion_intensity:.2f}, "
                f"{parsed.animation}): {parsed.text}"
            )

            await websocket.send_text(json.dumps(parsed.to_dict()))

            session.trim_history(MAX_HISTORY_ENTRIES)

    except WebSocketDisconnect:
        logger.info("client disconnected")
    except Exception:
        logger.exception("websocket loop crashed")


def _parse_user_frame(raw: str) -> str:
    """Accept either {"text": "..."} JSON or plain text, return stripped text."""
    user_text = raw
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict) and "text" in obj:
            user_text = obj["text"]
    except json.JSONDecodeError:
        pass
    return (user_text or "").strip()


async def _run_dialogue_turn(
    websocket: WebSocket,
    session,
    user_text: str,
) -> str:
    """Drive one user turn through Gemini, handling any tool calls.

    Returns the final text reply (with emotion/animation tags). The
    caller writes it to the WS as a reply frame. History accumulation
    is handled by the session itself.
    """

    response = session.send_user_message(user_text)

    for round_idx in range(MAX_TOOL_ROUNDS):

        if not response["function_calls"]:
            return response["text"]

        logger.info(
            f"tool round {round_idx + 1}: "
            f"{[fc['name'] for fc in response['function_calls']]}"
        )

        results: list[tuple] = []

        for fc in response["function_calls"]:
            tool_id = str(uuid.uuid4())

            await websocket.send_text(json.dumps({
                "type": "tool_call",
                "id": tool_id,
                "name": fc["name"],
                "args": fc["args"],
            }))

            payload = await _await_tool_result(websocket, tool_id)
            results.append((fc["name"], payload))

        response = session.send_function_responses(results)

    logger.warning(
        f"hit MAX_TOOL_ROUNDS ({MAX_TOOL_ROUNDS}); returning whatever text we have"
    )
    return response["text"]


async def _await_tool_result(websocket: WebSocket, tool_id: str) -> dict:
    """Wait for the renderer to return a tool_result frame matching
    tool_id. Drops non-matching frames with a warning so an
    interleaved user message can't poison the Gemini loop."""

    try:
        while True:
            raw = await asyncio.wait_for(
                websocket.receive_text(),
                timeout=TOOL_TIMEOUT_SECONDS,
            )

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("tool wait: non-JSON frame, dropped")
                continue

            if not isinstance(msg, dict):
                logger.warning("tool wait: non-object frame, dropped")
                continue

            if msg.get("type") != "tool_result":
                logger.warning(
                    f"tool wait: dropped frame type={msg.get('type')!r}"
                )
                continue

            if msg.get("id") != tool_id:
                logger.warning(
                    f"tool wait: id mismatch {msg.get('id')!r} != {tool_id!r}"
                )
                continue

            if msg.get("error"):
                return {"error": str(msg["error"])}

            return {"result": msg.get("result") or {}}

    except asyncio.TimeoutError:
        logger.warning(f"tool wait: timeout for {tool_id}")
        return {"error": "tool execution timed out"}
