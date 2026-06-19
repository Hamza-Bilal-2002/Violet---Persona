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
    "plain text"                                    (legacy text)6y
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

from pydantic import BaseModel

from .config import settings
from .llm import client as llm_client
from .memory import memory as memory_store
from .protocol import parse_reply
from .store import store as message_store
from .tools import SERVER_SIDE_TOOLS


# How many prior messages to replay from the SQLite store when a
# new WebSocket connects. 60 entries ~ 30 turns, which is roughly
# what fits comfortably in gpt-4o-mini's context without bloating
# token spend. The session then accumulates new turns on top.

SEED_HISTORY_LIMIT = 60


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

# How many long-term memories to retrieve and inject per user turn.
# Small on purpose: a handful of genuinely relevant facts steers the
# reply without bloating tokens or burying the model in trivia.
MEMORY_TOP_K = 6


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
        "memory_count": memory_store.count(),
        "llm": llm_client.status(),
    }


# ── Long-term memory: formatting + management API ────────────────────────────

def _format_memories(memories: list[dict]) -> str:
    """Render recalled memories into the system block the model reads.
    Empty list -> empty string (injects nothing)."""
    if not memories:
        return ""
    lines = [
        f"- [{m['type']}] {m['content']}"
        for m in memories
    ]
    return (
        f"LONG-TERM MEMORY — durable facts you know about {settings.user_name}. "
        "Use them naturally when relevant; do NOT recite them or mention that you "
        "have memory unless asked.\n" + "\n".join(lines)
    )


def _public_memory(row: dict) -> dict:
    """Strip internal fields (e.g. the raw embedding blob) before
    returning a memory over the REST API."""
    return {k: v for k, v in row.items() if not k.startswith("_")}


class MemoryCreate(BaseModel):
    content: str
    type: str = "user"
    importance: float = 0.5
    source: str = "manual"


class MemoryEdit(BaseModel):
    content: str | None = None
    type: str | None = None
    importance: float | None = None


@app.get("/memory")
async def memory_list():
    """All stored memories — for the management UI and 'what do you know
    about me' recall."""
    return {
        "count": memory_store.count(),
        "memories": [_public_memory(m) for m in memory_store.list_all()],
    }


@app.get("/memory/search")
async def memory_search(q: str, k: int = MEMORY_TOP_K):
    """Semantic search — handy for debugging retrieval quality."""
    results = await memory_store.search(q, k=k)
    return {"query": q, "results": [_public_memory(m) for m in results]}


@app.post("/memory")
async def memory_add(body: MemoryCreate):
    row = await memory_store.add(
        body.content,
        mem_type=body.type,
        importance=body.importance,
        source=body.source,
    )
    if row is None:
        return {"ok": False, "error": "empty content"}
    return {"ok": True, "memory": _public_memory(row)}


@app.patch("/memory/{mem_id}")
async def memory_edit(mem_id: int, body: MemoryEdit):
    row = await memory_store.update(
        mem_id,
        content=body.content,
        mem_type=body.type,
        importance=body.importance,
    )
    if row is None:
        return {"ok": False, "error": "not found"}
    return {"ok": True, "memory": _public_memory(row)}


@app.delete("/memory/{mem_id}")
async def memory_delete(mem_id: int):
    return {"ok": memory_store.delete(mem_id)}


@app.post("/memory/reset")
async def memory_reset():
    """Wipe all long-term memory. The resettable-memory control."""
    removed = memory_store.reset()
    return {"ok": True, "removed": removed}


@app.websocket("/chat/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    logger.info("client connected")

    # Phase 4 Wave 4.3: seed the new chat session with persisted
    # history from the SQLite store, so Violet picks up where the
    # last session left off across backend restarts.

    seed_history = []
    try:
        seed_history = message_store.load_recent(limit=SEED_HISTORY_LIMIT)
        logger.info(
            f"loaded {len(seed_history)} prior messages from store"
        )
    except Exception:
        logger.exception("could not load message history; starting fresh")

    try:
        session = llm_client.create_session(seed_history=seed_history)
    except Exception as e:
        logger.exception("could not create chat session")
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

            # Phase 5: recall relevant long-term memories for this turn
            # and inject them into the session. Best-effort — if the
            # embed service is down, we just run the turn memory-less.
            try:
                recalled = await memory_store.search(user_text, k=MEMORY_TOP_K)
                session.set_memory_context(_format_memories(recalled))
                if recalled:
                    logger.info(
                        f"memory: recalled {len(recalled)} "
                        f"[{', '.join(str(m['id']) for m in recalled)}]"
                    )
            except Exception:
                logger.exception("memory recall failed — continuing memory-less")
                session.set_memory_context("")

            try:
                final_text, used_tools = await _run_dialogue_turn(
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

            # Phase 4 Wave 4.3: append this turn to the persistent
            # store. We persist the RAW final_text (with tags) so
            # the model sees its own prior tag formatting on
            # reload — same shape that lives inside session.

            try:
                message_store.append("user", user_text)
                message_store.append("assistant", final_text, is_tool_reply=used_tools)
            except Exception:
                logger.exception("failed to persist turn — continuing")

            # Phase 5: auto-extract durable facts in the background using
            # the clean spoken text (tags stripped). Fire-and-forget so it
            # never delays the next turn.
            asyncio.create_task(_extract_and_store(user_text, parsed.text))

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
) -> tuple[str, bool]:
    """Drive one user turn through the LLM, handling any tool calls.

    Returns (final_text, used_tools). used_tools is True if at least
    one tool call round happened — the caller uses this to mark the
    persisted assistant turn so it is excluded from future session
    seeding (preventing the model from learning to skip tool calls).
    """

    response = session.send_user_message(user_text)
    used_tools = False

    for round_idx in range(MAX_TOOL_ROUNDS):

        if not response["function_calls"]:
            return response["text"], used_tools

        used_tools = True
        logger.info(
            f"tool round {round_idx + 1}: "
            f"{[fc['name'] for fc in response['function_calls']]}"
        )

        results: list[tuple] = []

        for fc in response["function_calls"]:

            # Memory tools run inside the api against the long-term store
            # — never forwarded to the renderer. Everything else is a PC
            # action the client executes.
            if fc["name"] in SERVER_SIDE_TOOLS:
                payload = await _execute_memory_tool(fc["name"], fc["args"])
                results.append((fc["name"], payload))
                continue

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
    return response["text"], used_tools


async def _execute_memory_tool(name: str, args: dict) -> dict:
    """Run a server-side memory tool against the long-term store and
    return a payload shaped like _await_tool_result ({result}/{error})
    so it feeds back into the model identically to client-side tools."""
    args = args or {}
    try:
        if name == "remember":
            row = await memory_store.add(
                args.get("content", ""),
                mem_type=args.get("type", "user"),
                importance=float(args.get("importance", 0.6)),
                source="tool",
            )
            if row is None:
                return {"error": "nothing to remember (empty content)"}
            return {"result": {
                "saved": True,
                "content": row["content"],
                "type": row["type"],
            }}

        if name == "recall":
            hits = await memory_store.search(
                args.get("query", ""), k=MEMORY_TOP_K
            )
            return {"result": {
                "memories": [
                    {"type": m["type"], "content": m["content"]}
                    for m in hits
                ],
            }}

        if name == "forget":
            hits = await memory_store.search(
                args.get("query", ""), k=1, min_score=0.4
            )
            if not hits:
                return {"result": {
                    "forgotten": False,
                    "reason": "no matching memory found",
                }}
            top = hits[0]
            memory_store.delete(top["id"])
            return {"result": {"forgotten": True, "content": top["content"]}}

        return {"error": f"unknown memory tool: {name}"}

    except Exception as e:
        logger.exception(f"memory tool {name} failed")
        return {"error": str(e)}


async def _extract_and_store(user_text: str, assistant_text: str) -> None:
    """Background task: distill durable facts from a turn and store them.
    Fully best-effort — runs after the reply is already sent, so a slow
    or failed extraction never affects the user's experience."""
    try:
        # extract_memories is a sync LLM call; offload so we don't block
        # the event loop.
        facts = await asyncio.to_thread(
            llm_client.extract_memories,
            user_text,
            assistant_text,
            settings.user_name,
        )
        for f in facts:
            await memory_store.add(
                f["content"],
                mem_type=f.get("type", "user"),
                importance=float(f.get("importance", 0.5)),
                source="auto",
            )
        if facts:
            logger.info(f"memory: auto-extracted {len(facts)} fact(s)")
    except Exception:
        logger.exception("background memory extraction failed")


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
