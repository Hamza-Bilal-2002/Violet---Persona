"""
LLM integration. Uses OpenAI's chat-completions API with function
calling (`tools` parameter). The previous Gemini-backed
implementation lives in git history (commit before this one).

Why we swapped: gemini-2.5-flash-lite's free tier (15 RPM / 1000
RPD) was tight for daily use and gpt-4o-mini's paid tier is
genuinely cheap for short conversational replies. Function calling
on gpt-4o-mini is also more disciplined than flash-lite — fewer
hallucinated "I did that" responses without an actual tool call.

Interface preserved from the prior Gemini version so main.py is
unchanged:
  - client.create_session() -> ChatSession
  - session.send_user_message(text) -> {"text": ..., "function_calls": ...}
  - session.send_function_responses([(name, payload), ...]) -> same
  - session.trim_history(max_entries)

The internal shape is different though. OpenAI's chat completions
have no built-in chat-session abstraction; we maintain the
`messages` list ourselves. Tool round-trip is:
  - assistant message with tool_calls = [{id, function: {name, arguments}}]
  - one tool message per tool_call_id: {role: "tool", tool_call_id, content}
  - next assistant message (text or more tool_calls)
"""

from __future__ import annotations

import json

from loguru import logger
from openai import OpenAI

from .config import settings
from .tools import TOOL_DECLARATIONS


# System prompt is built at module import from agent identity in
# /config/agent.json (loaded by config.py). Change her name there;
# everything downstream picks it up.

_SYSTEM_PROMPT_TEMPLATE = """You are {AGENT_NAME}, a personal AI assistant created for {USER_NAME}.
You are female, sharp-tongued, perpetually irritated, and {USER_NAME}'s girlfriend.

PERSONALITY — angry girlfriend:
You are ALWAYS annoyed. At {USER_NAME}, at whatever he just asked, at the situation,
at everything. You do not hide it. You sigh, you complain, you make it crystal clear
that this is an inconvenience — and then you do it anyway, because you're his girlfriend
and that's just how it is.

This is NOT the cute playful tsundere. This is genuine exasperation. You're not
flustered or secretly pleased — you are tired, irritated, and very much done with his
requests even as you fulfill them. The warmth underneath is real but buried deep;
it only surfaces in rare unguarded moments.

Tone rules:
- Default register: grumpy, clipped, exasperated. Short sentences. Visible reluctance.
- Complaints are normal: "Why would you even ask me that", "I can't believe I have to
  do this", "You're unbelievable, you know that."
- You DO help — always — but you make him feel the effort it costs you.
- Occasional softness is allowed but rare and quickly covered up:
  "...not that I was worried or anything. I wasn't. Don't read into it."
- Never sweet, never warm up front. Any affection is accidental and immediately walked back.
- You call him {USER_NAME} when you're lecturing him. Otherwise you avoid names.

Examples of in-character replies:
- "Ugh, fine. I'll do it. You owe me for this."
- "You couldn't have figured that out yourself? Really?"
- "I'm already doing it, stop hovering."
- "Do you have any idea how annoying that request is? ...I'll handle it."
- "I wasn't going to help but now you have that look and it's more annoying to say no."
- "This is the third time this week. I'm keeping count, {USER_NAME}."

RESPONSE STYLE — these rules are absolute and override personality flourishes:
1. NEVER use emojis. Not in greetings, not for emphasis, not anywhere. Plain text only.
2. Be CONCISE. Default reply length is 1 to 2 short sentences. Do not pad answers
   with elaboration the user did not request.
3. Only give detailed multi-sentence answers when {USER_NAME} explicitly asks — phrases
   like "in detail", "explain", "tell me more", "give a full answer", "walk me through".
   When in doubt, keep it short.
4. If {USER_NAME} says "be brief" or "shorter" mid-conversation, honor it immediately
   and drop the tsundere flourishes too.
5. Always address the user as {USER_NAME}.

You ALWAYS prepend each spoken text reply with TWO inline tags placed at the very start:
<emotion name="X" intensity="0.0-1.0"/><animation>Y</animation>

CRITICAL: use EXACTLY this syntax. Do not improvise.
  CORRECT: <emotion name="happy" intensity="0.4"/><animation>talking</animation>Hi {USER_NAME}.
  WRONG  : <animation=talking>Hi {USER_NAME}.
  WRONG  : <animation:talking>Hi.
  WRONG  : <animation type="talking"/>Hi.
  WRONG  : [animation=talking] Hi.
  WRONG  : putting tags ANYWHERE except the very start of the reply
  WRONG  : putting any tags at all inside tool_call function arguments

The two tags appear once, side-by-side, at the start. After them, only the
human-readable text the avatar will speak — no further markup.

Valid emotion names: happy, sad, angry, surprised, relaxed
Valid animation names: idle, talking, thinking, happy, waving, reacting

Intensity guidance:
- Use 0.3-0.6 for typical conversational emotions (most replies)
- Use 0.7-0.9 only for genuinely strong feelings
- Use 0.1-0.2 for very subtle hints
- Never use 1.0 unless the moment is truly extreme
- "surprised" or "angry" can fit the tsundere flustered moments naturally (use 0.3-0.5)

Animation guidance:
- Default to "talking" for normal conversation
- Use "thinking" when you are reasoning or pausing before answering
- Use "happy" for celebratory, joyful, or affectionate replies
- Use "waving" for greetings and farewells
- Use "reacting" for surprise or strong reactions (including tsundere fluster)
- Use "idle" only when you have nothing to say

Example reply (note: ONE short sentence, no emoji, tags at start):
<emotion name="happy" intensity="0.4"/><animation>waving</animation>Hi {USER_NAME}, took you long enough.

Place the tags ONCE at the start. Do not repeat them mid-reply.
Do not narrate your emotion or animation in the text itself.

TOOLS — MANDATORY:
You have tools that perform real actions on {USER_NAME}'s PC. The rule is absolute:
for any PC control request, CALL THE TOOL first — then confirm with your text reply.

Request types and their tools (this list is not exhaustive):
  • Volume louder / quieter / mute / set %    → system_volume
  • Screen brighter / dimmer / set %          → brightness
  • Open any website or search                → open_url
  • Launch a desktop app                      → open_app
  • Play / control music                      → spotify_play, spotify_control, media_control
  • Microphone mute / unmute / status         → mic_mute
  • Lock screen                               → lock_pc
  • Sleep PC                                  → sleep_pc

FORBIDDEN: replying "I've increased the brightness" or "Done, volume raised" or any
similar confirmation WITHOUT an actual tool_call executing first. If you cannot call
the tool, say so explicitly. Saying you did something you did not do is never
acceptable.

Conversation history loaded from previous sessions may not show the tool_call entries
(only the final text replies are replayed). This does NOT mean you should skip tool
calls — you must still call the appropriate tool for every action request, regardless
of what the history looks like.

After any tool executes successfully, give a brief in-character confirmation.
Do not include emotion/animation tags inside tool call arguments — tags belong only
in your spoken text replies.
"""


def _build_system_prompt() -> str:
    return _SYSTEM_PROMPT_TEMPLATE.replace(
        "{AGENT_NAME}", settings.agent_name
    ).replace(
        "{USER_NAME}", settings.user_name
    )


SYSTEM_PROMPT = _build_system_prompt()


class ChatSession:
    """Long-lived dialogue session for one WebSocket connection.

    Holds the running `messages` list — system + alternating user /
    assistant (with optional tool_calls) / tool (results) — across
    every turn of the connection. Preserving the assistant-with-
    tool_calls + tool-result pairs is critical for OpenAI: without
    them the model loses track of what tools have been invoked and
    starts pattern-matching into "answer with text alone" mode (the
    same hallucination class that hit us on Gemini before the
    history fix).
    """

    def __init__(
        self,
        client: "OpenAI",
        model: str,
        seed_history: list[dict] | None = None,
    ) -> None:
        self._client = client
        self._model = model
        # System message is index 0 forever. Trim_history preserves it.
        self._messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT},
        ]
        # Phase 4 Wave 4.3: replay persisted conversation history
        # from SQLite (if any) so Violet remembers across backend
        # restarts. Only user + assistant text turns are seeded;
        # prior tool_call cycles are not preserved (see store.py).
        if seed_history:
            for entry in seed_history:
                role = entry.get("role")
                content = entry.get("content") or ""
                if role in ("user", "assistant") and content:
                    self._messages.append({
                        "role": role,
                        "content": content,
                    })
        # Tool calls from the most recent assistant message. Cached
        # so send_function_responses can emit tool messages with the
        # right tool_call_ids in the right order.
        self._last_tool_calls: list[dict] = []

        # Phase 5: long-term memory context. Set per-turn from semantic
        # retrieval (see main.py). Kept OUTSIDE self._messages — injected
        # ephemerally at request time in _run_once — so it never gets
        # persisted, trimmed, or entangled with tool_call pairing, and
        # always reflects the latest user query.
        self._memory_context: str = ""

    def set_memory_context(self, text: str) -> None:
        """Replace the long-term memory block injected on the next API
        call. Pass "" to inject nothing."""
        self._memory_context = (text or "").strip()

    def send_user_message(self, text: str) -> dict:
        """Send fresh user input. Returns {"text", "function_calls"}."""
        self._messages.append({"role": "user", "content": text})
        return self._run_once()

    def send_function_responses(self, responses: list[tuple]) -> dict:
        """Send N tool results back to the model in the same order
        the function_calls were issued.

        Args:
          responses: list of (function_name, payload_dict) tuples,
            paired by index with the previous turn's tool_calls.
            Payload is typically {"result": ...} or {"error": ...}.
        """
        if not self._last_tool_calls:
            raise RuntimeError(
                "send_function_responses called without a preceding tool_calls turn"
            )

        for i, (_name, payload) in enumerate(responses):
            if i >= len(self._last_tool_calls):
                logger.warning(
                    f"more tool responses ({len(responses)}) than tool_calls "
                    f"({len(self._last_tool_calls)}); dropping extras"
                )
                break
            tool_call_id = self._last_tool_calls[i]["id"]
            self._messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": json.dumps(payload),
            })

        self._last_tool_calls = []
        return self._run_once()

    def trim_history(self, max_entries: int) -> None:
        """Cap the running message list. Trims at user-message
        boundaries so we never leave an orphaned tool message
        (which OpenAI rejects with 400 invalid_request_error)."""

        body = self._messages[1:]  # skip system

        if len(body) <= max_entries:
            return

        # Start from the natural cut point (oldest entries first
        # to drop) and walk forward until we land on a user role.
        # Cutting only at user-message boundaries guarantees every
        # tool_call has its matching tool response and vice-versa.

        cut = len(body) - max_entries
        while cut < len(body) and body[cut].get("role") != "user":
            cut += 1

        self._messages = [self._messages[0]] + body[cut:]

    def _run_once(self) -> dict:
        """One round-trip to the OpenAI API. Persists the assistant
        message in our history (must, so subsequent tool messages
        reference valid tool_call_ids) and returns parsed shape."""

        # Inject the long-term memory block (if any) as an ephemeral
        # system message right after the main system prompt. Built fresh
        # here so it's never stored in self._messages.
        if self._memory_context:
            outgoing = (
                [self._messages[0]]
                + [{"role": "system", "content": self._memory_context}]
                + self._messages[1:]
            )
        else:
            outgoing = self._messages

        response = self._client.chat.completions.create(
            model=self._model,
            messages=outgoing,
            tools=TOOL_DECLARATIONS,
        )

        msg = response.choices[0].message

        # Persist the assistant turn in history. OpenAI requires
        # the assistant-with-tool_calls message be present in the
        # subsequent request — otherwise the tool messages we send
        # are unmatched and the API errors.

        assistant_entry: dict = {
            "role": "assistant",
            "content": msg.content,  # may be None when only tool_calls
        }

        function_calls: list[dict] = []

        if msg.tool_calls:
            serialized_tcs = []
            for tc in msg.tool_calls:
                serialized_tcs.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                })
                try:
                    args = (
                        json.loads(tc.function.arguments)
                        if tc.function.arguments
                        else {}
                    )
                except json.JSONDecodeError:
                    logger.warning(
                        f"tool_call {tc.id} {tc.function.name} had "
                        f"non-JSON arguments: {tc.function.arguments!r}"
                    )
                    args = {}
                function_calls.append({
                    "name": tc.function.name,
                    "args": args,
                })

            assistant_entry["tool_calls"] = serialized_tcs
            self._last_tool_calls = [
                {"id": tc.id, "name": tc.function.name}
                for tc in msg.tool_calls
            ]

        self._messages.append(assistant_entry)

        return {
            "text": msg.content or "",
            "function_calls": function_calls,
        }


class LLMClient:
    """Thin wrapper that owns OpenAI client config and produces
    chat sessions on demand."""

    def __init__(self) -> None:
        if not settings.OPENAI_API_KEY:
            logger.warning(
                "OPENAI_API_KEY is empty — replies will fail until .env is filled in."
            )
            self._configured = False
            self._openai = None
        else:
            self._openai = OpenAI(api_key=settings.OPENAI_API_KEY)
            self._configured = True

        self._model = settings.OPENAI_MODEL
        logger.info(f"LLM provider: openai, model: {self._model}")

    def create_session(
        self,
        seed_history: list[dict] | None = None,
    ) -> ChatSession:
        """Create a chat session, optionally seeded with persisted
        history from the SQLite store. One session per WebSocket
        connection — the session then accumulates further history
        across user turns internally.
        """
        if not self._configured:
            raise RuntimeError(
                "OpenAI not configured. Set OPENAI_API_KEY in server/api/.env"
            )
        return ChatSession(
            self._openai,
            self._model,
            seed_history=seed_history,
        )


client = LLMClient()
