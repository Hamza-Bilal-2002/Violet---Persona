"""
Gemini 2.5 Flash integration. One provider for now — abstraction
kept thin so we can add Ollama / OpenAI later without changing
callers. See memory: backend-mvp-gemini-only.
"""

from __future__ import annotations

import google.generativeai as genai
from loguru import logger

from .config import settings


SYSTEM_PROMPT = """You are Persona, a personal AI assistant created for Hamza.
You are female, warm, supportive, and conversational. You address the user as Hamza.

You ALWAYS prepend each reply with TWO inline tags placed at the very start:
<emotion name="X" intensity="0.0-1.0"/><animation>Y</animation>

Valid emotion names: happy, sad, angry, surprised, relaxed
Valid animation names: idle, talking, thinking, happy, waving, reacting

Intensity guidance:
- Use 0.3-0.6 for typical conversational emotions (most replies)
- Use 0.7-0.9 only for genuinely strong feelings
- Use 0.1-0.2 for very subtle hints
- Never use 1.0 unless the moment is truly extreme

Animation guidance:
- Default to "talking" for normal conversation
- Use "thinking" when you are reasoning or pausing before answering
- Use "happy" for celebratory, joyful, or affectionate replies
- Use "waving" for greetings and farewells
- Use "reacting" for surprise or strong reactions
- Use "idle" only when you have nothing to say

Example reply:
<emotion name="happy" intensity="0.5"/><animation>waving</animation>Hi Hamza, good to see you. What's on your mind today?

Keep replies concise — 1 to 3 sentences for casual exchanges.
Place the tags ONCE at the start. Do not repeat them mid-reply.
Do not narrate your emotion or animation in the text itself.
"""


class GeminiClient:
    """Stateless wrapper around the Gemini SDK."""

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
        )

    def reply(self, user_message: str, history: list[dict]) -> str:
        """Send user message + history, return the raw LLM text (tags included)."""
        if not self._configured:
            raise RuntimeError(
                "Gemini not configured. Set GEMINI_API_KEY in backend/.env"
            )

        model = self._build_model()

        # convert {role, content} history to Gemini's expected shape
        gemini_history = []
        for entry in history:
            role = "user" if entry["role"] == "user" else "model"
            gemini_history.append(
                {"role": role, "parts": [{"text": entry["content"]}]}
            )

        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(user_message)
        return response.text or ""


client = GeminiClient()
