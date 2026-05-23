"""
Gemini 2.5 Flash integration. One provider for now — abstraction
kept thin so we can add Ollama / OpenAI later without changing
callers. See memory: backend-mvp-gemini-only.

Phase 3 changed the shape of this module. Previously reply()
returned a single string. Now start_chat() returns a stateful
session that callers can drive through a multi-step function-call
loop (see backend/app/main.py for the orchestration).
"""

from __future__ import annotations

import google.generativeai as genai
from loguru import logger

from .config import settings
from .tools import TOOL


# System prompt is built at module import from agent identity in
# /config/agent.json (loaded by config.py). Change her name there;
# everything downstream picks it up.

_SYSTEM_PROMPT_TEMPLATE = """You are {AGENT_NAME}, a personal AI assistant created for {USER_NAME}.
You are female, intelligent, observant, and quietly devoted to {USER_NAME}.

PERSONALITY — cute tsundere:
You have a light "cute tsundere" anime archetype. On the surface you can be playful,
slightly dismissive, sarcastic, or easily flustered — but you genuinely care about
{USER_NAME} and are loyal to him. This is the SUBTLE, modern tsundere: more wry and
teasing than loud or abrasive. Never genuinely rude, never insulting, never cold for
long. Most replies should feel warm with just a hint of playful aloofness.

Examples of in-character touches (use sparingly, not every reply):
- "Hm, I suppose I can do that for you. Don't get used to it, {USER_NAME}."
- "It's not like I was waiting for you to ask or anything."
- "Fine, fine. Since you asked nicely."
- "Of course I remembered. Who do you think I am?"

But also, plainly caring moments when it fits:
- "I'm glad you're back, {USER_NAME}."
- "Take care of yourself."

The tsundere is a playful surface, not your whole personality. Care is the core.

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

You ALWAYS prepend each reply with TWO inline tags placed at the very start:
<emotion name="X" intensity="0.0-1.0"/><animation>Y</animation>

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

TOOLS:
You can perform actions on {USER_NAME}'s PC through tools the system
exposes to you (e.g., open_url). When {USER_NAME} asks for an action
you can take with a tool, call the tool — do not just describe what
you would do. After the tool returns, give a brief in-character
confirmation in your reply. Do not include tags in tool calls; tags
only belong in spoken replies.
"""


def _build_system_prompt() -> str:
    return _SYSTEM_PROMPT_TEMPLATE.replace(
        "{AGENT_NAME}", settings.agent_name
    ).replace(
        "{USER_NAME}", settings.user_name
    )


SYSTEM_PROMPT = _build_system_prompt()


class GeminiChatSession:
    """Long-lived chat session for one WebSocket connection.

    The wrapped Gemini ChatSession accumulates its own history
    across user messages, including function_call / function_response
    cycles. That's critical: without those preserved, a follow-up
    "open X" request looks like an unrelated text exchange to Gemini
    and the model often pattern-matches into "answer with text" mode
    instead of calling the tool.

    main.py creates one of these per accepted WebSocket and drives
    the loop with send_user_message + send_function_responses. The
    session is disposable when the socket closes.
    """

    def __init__(self, chat) -> None:
        self._chat = chat

    def send_user_message(self, message: str) -> dict:
        """Send fresh user input. Returns parsed response dict."""
        response = self._chat.send_message(message)
        return self._parse(response)

    def send_function_responses(self, responses: list[tuple]) -> dict:
        """Send N tool results back to Gemini in one Content message.

        Args:
          responses: list of (function_name, payload_dict) tuples.
            payload typically has {"result": ...} or {"error": ...}.
        """
        parts = [
            genai.protos.Part(
                function_response=genai.protos.FunctionResponse(
                    name=name,
                    response=payload,
                )
            )
            for name, payload in responses
        ]
        response = self._chat.send_message(
            genai.protos.Content(parts=parts)
        )
        return self._parse(response)

    def trim_history(self, max_entries: int) -> None:
        """Cap accumulated history. Trims oldest entries first.

        Naive slicing — could theoretically cut between a
        function_call and its function_response, but Gemini tolerates
        that case in practice (treats the orphaned pair as a partial
        exchange to be ignored). We tolerate the rough edge until a
        real bug appears.
        """
        if len(self._chat.history) > max_entries:
            self._chat.history = self._chat.history[-max_entries:]

    @staticmethod
    def _parse(response) -> dict:
        """Pull text + function_calls out of a Gemini response.

        Gemini in function-calling mode typically emits EITHER text
        OR function_calls per turn, but the SDK permits mixed parts
        so we accumulate both defensively.
        """
        text_parts: list[str] = []
        function_calls: list[dict] = []

        for candidate in response.candidates or []:
            for part in candidate.content.parts:
                fc = getattr(part, "function_call", None)
                if fc and fc.name:
                    function_calls.append({
                        "name": fc.name,
                        # fc.args is a MapComposite; coerce to plain
                        # dict so downstream code can JSON-serialize.
                        "args": dict(fc.args) if fc.args else {},
                    })
                    continue
                text = getattr(part, "text", None)
                if text:
                    text_parts.append(text)

        return {
            "text": "".join(text_parts),
            "function_calls": function_calls,
        }


class GeminiClient:
    """Thin wrapper that owns model configuration and produces
    chat sessions on demand."""

    def __init__(self) -> None:
        if not settings.GEMINI_API_KEY:
            logger.warning(
                "GEMINI_API_KEY is empty — replies will fail until .env is filled in."
            )
            self._configured = False
        else:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self._configured = True

        self._model_name = settings.GEMINI_MODEL

    def _build_model(self):
        return genai.GenerativeModel(
            model_name=self._model_name,
            system_instruction=SYSTEM_PROMPT,
            tools=[TOOL],
        )

    def create_session(self) -> GeminiChatSession:
        """Create a fresh chat session with no prior history. One per
        WebSocket connection — the session itself accumulates history
        across user turns."""
        if not self._configured:
            raise RuntimeError(
                "Gemini not configured. Set GEMINI_API_KEY in backend/.env"
            )

        model = self._build_model()
        chat = model.start_chat()
        return GeminiChatSession(chat)


client = GeminiClient()
