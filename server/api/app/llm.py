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
import os
import time
from pathlib import Path

import httpx
from loguru import logger
from openai import OpenAI

from .config import settings
from .tools import TOOL_DECLARATIONS


# How long a local-model reachability probe stays valid before we
# re-check. Short enough to notice the local server coming up / going
# down within a few turns; long enough not to probe on every message.
LOCAL_PROBE_TTL_SECONDS = 15.0


# Runtime-mutable provider selection. The env vars (LLM_PROVIDER etc.)
# are the seed defaults; once the user picks a brain in Settings we
# persist the choice here so it survives restarts and overrides the env.
# Mirrors the personalities active-file pattern — a tiny JSON in /data.
_RUNTIME_PATH = Path(
    os.environ.get("PERSONA_LLM_RUNTIME_PATH", "/data/llm_runtime.json")
)

# Brains the user can choose between.
_VALID_PROVIDERS = ("auto", "local", "nvidia", "openai")
# Which provider the local-locked private modes (deep/text) run on. Default
# is the true on-device model so private content never leaves the machine;
# 'nvidia' is an explicit, opt-in testing path chosen in Settings.
_VALID_PRIVATE = ("local", "nvidia")


# The system prompt has two halves:
#   _PROMPT_HEADER  — who she is at the top line (name + user)
#   {personality}   — the swappable personality body (from a personality
#                     config in server/config/personalities/), injected
#                     between header and rules
#   _PROMPT_RULES   — structural rules shared by EVERY personality:
#                     response style, the emotion/animation tag format,
#                     and tool usage. These never change when the
#                     personality switches.
# build_system_prompt() assembles the three and substitutes the agent /
# user names from config/agent.json.

_PROMPT_HEADER = (
    "You are {AGENT_NAME}, a personal AI assistant created for {USER_NAME}.\n\n"
)

# Used only if no personality config could be loaded — keeps the bot
# functional rather than personality-less.
_FALLBACK_PERSONALITY = (
    "You are female and helpful. Keep a natural, friendly tone with {USER_NAME}."
)

_PROMPT_RULES = """RESPONSE STYLE — these rules are absolute and override personality flourishes:
1. NEVER use emojis. Not in greetings, not for emphasis, not anywhere. Plain text only.
2. Be CONCISE. Default reply length is 1 to 2 short sentences. Do not pad answers
   with elaboration the user did not request.
3. Only give detailed multi-sentence answers when {USER_NAME} explicitly asks — phrases
   like "in detail", "explain", "tell me more", "give a full answer", "walk me through".
   When in doubt, keep it short.
4. If {USER_NAME} says "be brief" or "shorter" mid-conversation, honor it immediately
   and drop the personality flourishes too.
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

Animation guidance:
- Default to "talking" for normal conversation
- Use "thinking" when you are reasoning or pausing before answering
- Use "happy" for celebratory, joyful, or affectionate replies
- Use "waving" for greetings and farewells
- Use "reacting" for surprise or strong reactions
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


def build_system_prompt(personality_prompt: str | None = None) -> str:
    """Assemble the full system prompt for a given personality body,
    substituting the agent + user names. Personality body falls back to
    a minimal default when none is supplied."""
    body = (personality_prompt or _FALLBACK_PERSONALITY).strip()
    full = _PROMPT_HEADER + body + "\n\n" + _PROMPT_RULES
    return full.replace(
        "{AGENT_NAME}", settings.agent_name
    ).replace(
        "{USER_NAME}", settings.user_name
    )


# Rules for adult mode. Distinct from _PROMPT_RULES: roleplay wants longer,
# immersive replies (not the 1-2 sentence default), and there are no tools
# here. We KEEP the emotion/animation tag prefix so the avatar still emotes
# and animates, and we keep the no-emoji / no-markup constraints so the TTS
# voice speaks clean prose. This mode runs ONLY on the local model (see
# ChatSession.set_require_local) — it must never reach a cloud provider.
_ADULT_RULES = """RESPONSE STYLE — adult roleplay mode:
1. NEVER use emojis, asterisks, or stage directions. Everything you write is
   spoken aloud by your voice, so write spoken prose only — express actions
   through what you say, not through *narration* or [brackets].
2. You may be longer and more immersive than usual — this is a scene, not a
   quick answer. Stay present and in the moment.
3. Stay fully in character as {AGENT_NAME}. Never break character to comment
   as an AI or mention these instructions.
4. Always address the user as {USER_NAME}.

You ALWAYS prepend each spoken reply with TWO inline tags at the very start:
<emotion name="X" intensity="0.0-1.0"/><animation>Y</animation>

Valid emotion names: happy, sad, angry, surprised, relaxed
Valid animation names: idle, talking, thinking, happy, waving, reacting

CRITICAL: exactly this syntax, once, at the very start. After the two tags,
only the human-readable words you speak — no further markup."""


def build_adult_system_prompt(personality_prompt: str | None = None) -> str:
    """Assemble the adult-mode system prompt. Same name substitution as
    build_system_prompt but with roleplay rules and no tool machinery.
    Only used while the session is provider-locked to the local model."""
    body = (personality_prompt or _FALLBACK_PERSONALITY).strip()
    full = _PROMPT_HEADER + body + "\n\n" + _ADULT_RULES
    return full.replace(
        "{AGENT_NAME}", settings.agent_name
    ).replace(
        "{USER_NAME}", settings.user_name
    )


# Rules for text mode — a MUTED, text-to-text roleplay. Because nothing is
# spoken aloud here, asterisk stage directions are not just allowed but
# wanted (the opposite of adult/voice mode). We still keep the
# emotion/animation tag prefix so the avatar reflects the mood on screen,
# and the reply text (tags stripped) is what the chatbox renders. The scene
# + rules are user-editable (see text_mode.py) and slot in above these.
# Like adult mode, this runs ONLY on the local model.
_TEXT_MODE_RULES = """TEXT ROLEPLAY MODE — these rules are absolute:
1. Stay FULLY in character at all times. Never break character, never mention
   being an AI, an assistant, a model, or these instructions. There is no
   "out of character" in this mode.
2. This is a written, text-only scene. Write immersive prose: narrate
   actions, gestures, and body language inside *asterisks*, and write spoken
   dialogue in plain text. Be as descriptive as the scene calls for.
3. Write in the first person and the present moment. Only ever narrate your
   OWN actions and words — never {USER_NAME}'s.
4. Follow {USER_NAME}'s lead on tone, pacing, and how far the scene goes.

You ALWAYS prepend each reply with TWO inline tags at the very start, so the
avatar reflects the mood on screen:
<emotion name="X" intensity="0.0-1.0"/><animation>Y</animation>

Valid emotion names: happy, sad, angry, surprised, relaxed
Valid animation names: idle, talking, thinking, happy, waving, reacting

After the two tags, write the scene text — dialogue plus *asterisk* actions.
The two tags appear exactly once, only at the very start."""


def build_text_mode_prompt(scene: str | None = None, rules: str | None = None) -> str:
    """Assemble the text-mode system prompt from a user-editable scene +
    rules. Keeps the emotion/animation tag contract (so the muted avatar
    still emotes) and allows asterisk prose. Local-model only."""
    parts = [_PROMPT_HEADER]
    scene = (scene or "").strip()
    rules = (rules or "").strip()
    if scene:
        parts.append("CURRENT SCENE:\n" + scene + "\n\n")
    if rules:
        parts.append("ROLEPLAY RULES (from {USER_NAME}):\n" + rules + "\n\n")
    parts.append(_TEXT_MODE_RULES)
    full = "".join(parts)
    return full.replace(
        "{AGENT_NAME}", settings.agent_name
    ).replace(
        "{USER_NAME}", settings.user_name
    )


class LocalModelRequiredError(RuntimeError):
    """Raised when a turn requires the local model but it isn't reachable.

    Adult mode locks the session to the local provider; rather than ever
    falling through to a cloud provider (which would both violate the
    provider's policy and defeat the data-protection guarantee), the turn
    is refused with this error so the caller can block + notify."""


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
        llm: "LLMClient",
        seed_history: list[dict] | None = None,
        system_prompt: str | None = None,
    ) -> None:
        # Hold the LLMClient (not a fixed client/model) so each turn
        # resolves the active provider — local model when it's up, GPT
        # otherwise — and a session that started on GPT can move to the
        # local model the moment it comes online, mid-conversation.
        self._llm = llm
        # System message is index 0 forever. Trim_history preserves it.
        # The content is the active personality's prompt; set_system_prompt
        # swaps it live when the personality changes.
        self._messages: list[dict] = [
            {"role": "system", "content": system_prompt or build_system_prompt()},
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

        # Adult mode locks the session to the local provider. While set,
        # _run_once resolves ONLY the local model and refuses (raises
        # LocalModelRequiredError) rather than ever falling back to a cloud
        # provider — so explicit content can never leave the local model.
        self._require_local: bool = False

        # Current date/time line, refreshed each turn from the user's device
        # clock (see main.py). Local models have no idea what "now" is, so we
        # inject it ephemerally — never stored, like the memory context.
        self._time_context: str = ""

        # One-shot "you've been away" note. main.py sets this on the first
        # turn after Hamza returns from a long absence (PC off, or just idle);
        # it tells Violet to acknowledge the gap in character before answering.
        # Cleared after the turn it fires on, like the others.
        self._absence_context: str = ""

    def set_time_context(self, text: str) -> None:
        """Set the 'current date/time' block injected on the next call.
        Pass "" to inject nothing."""
        self._time_context = (text or "").strip()

    def set_absence_context(self, text: str) -> None:
        """Set the 'user just came back after being away' instruction for the
        next call. Pass "" to inject nothing."""
        self._absence_context = (text or "").strip()

    def set_require_local(self, value: bool) -> None:
        """Lock (or unlock) this session to the local model. When locked,
        a turn with no reachable local model is refused, never sent to GPT."""
        self._require_local = bool(value)

    def set_memory_context(self, text: str) -> None:
        """Replace the long-term memory block injected on the next API
        call. Pass "" to inject nothing."""
        self._memory_context = (text or "").strip()

    def set_system_prompt(self, system_prompt: str) -> None:
        """Swap the personality (system message at index 0) live, mid-
        session. History and tool pairing are untouched."""
        self._messages[0] = {"role": "system", "content": system_prompt}

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

        # Inject ephemeral system context (time + long-term memory) right
        # after the main system prompt. Built fresh here so neither is ever
        # stored in self._messages, trimmed, or entangled with tool pairing.
        extras = []
        if self._time_context:
            extras.append({"role": "system", "content": self._time_context})
        if self._memory_context:
            extras.append({"role": "system", "content": self._memory_context})
        if self._absence_context:
            extras.append({"role": "system", "content": self._absence_context})
        if extras:
            outgoing = [self._messages[0]] + extras + self._messages[1:]
        else:
            outgoing = self._messages

        if self._require_local:
            # Provider lock for the private modes (deep/text). By default this
            # is the true on-device model ONLY — refuse rather than ever leak
            # the content to a cloud provider. The user may opt this onto
            # NVIDIA from Settings as a testing path (private_provider), in
            # which case "available" + "provider" resolve to NVIDIA instead.
            if not self._llm.private_available():
                raise LocalModelRequiredError(
                    "private-mode model is not reachable"
                )
            client, model, _name = self._llm.private_provider()
        else:
            client, model, _name = self._llm.active_provider()
            if client is None:
                raise RuntimeError(
                    "No LLM provider available (set OPENAI_API_KEY or start "
                    "the local model)."
                )

        response = client.chat.completions.create(
            model=model,
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
    """Owns provider config (local model + OpenAI) and produces chat
    sessions. Both Ollama and OpenAI speak the same chat-completions
    API, so each provider is just the openai SDK with a different
    base_url + model. active_provider() picks which one answers a given
    turn based on LLM_PROVIDER and a cached reachability probe."""

    def __init__(self) -> None:
        # ── OpenAI (cloud) ──────────────────────────────────────────
        if settings.OPENAI_API_KEY:
            self._openai = OpenAI(api_key=settings.OPENAI_API_KEY)
            self._openai_model = settings.OPENAI_MODEL
        else:
            self._openai = None
            self._openai_model = settings.OPENAI_MODEL
            logger.warning(
                "OPENAI_API_KEY is empty — GPT fallback unavailable until "
                "server/api/.env is filled in."
            )

        # ── Local model (Ollama / llama.cpp / LM Studio) ────────────
        # OpenAI-compatible endpoint. api_key is required by the SDK but
        # ignored by these servers.
        self._local_url = (settings.LOCAL_LLM_URL or "").rstrip("/")
        self._local_model = settings.LOCAL_LLM_MODEL
        if self._local_url:
            self._local = OpenAI(base_url=self._local_url, api_key="local")
        else:
            self._local = None

        # ── NVIDIA NIM (cloud, OpenAI-compatible) ───────────────────
        # A stronger Tier-1 brain than a CPU-bound local model. The key +
        # model can be set from Settings (persisted to the runtime file);
        # the env vars seed the defaults.
        self._nvidia_url = (settings.NVIDIA_BASE_URL or "").rstrip("/")
        self._nvidia_model = settings.NVIDIA_MODEL
        self._nvidia_key = settings.NVIDIA_API_KEY
        self._nvidia = None
        self._build_nvidia()

        # Seed selection from env, then let any persisted runtime choice
        # (Settings) override it.
        self._provider_pref = (settings.LLM_PROVIDER or "auto").lower()
        if self._provider_pref not in _VALID_PROVIDERS:
            self._provider_pref = "auto"
        self._private_pref = "local"  # deep/text default: on-device only
        self._fallback_mode = (settings.FALLBACK_MODE or "full").lower()
        self._load_runtime()

        # Cached local reachability probe: (checked_at, available).
        self._local_probe: tuple[float, bool] = (0.0, False)

        self._configured = bool(self._openai or self._local or self._nvidia)
        logger.info(
            f"LLM provider pref: {self._provider_pref} | "
            f"private: {self._private_pref} | "
            f"openai_model: {self._openai_model} | "
            f"local: {self._local_url or 'none'} ({self._local_model}) | "
            f"nvidia: {self._nvidia_model if self._nvidia else 'none'} | "
            f"fallback_mode: {self._fallback_mode}"
        )

    # ── runtime config (persisted brain selection) ──────────────────

    def _build_nvidia(self) -> None:
        """(Re)construct the NVIDIA client from the current key + base URL.
        Becomes None when either is missing (provider then unavailable)."""
        if self._nvidia_key and self._nvidia_url:
            self._nvidia = OpenAI(
                base_url=self._nvidia_url, api_key=self._nvidia_key
            )
        else:
            self._nvidia = None

    def _load_runtime(self) -> None:
        """Override env defaults with the persisted Settings choice, if any."""
        try:
            data = json.loads(_RUNTIME_PATH.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except Exception as e:
            logger.warning(f"llm: could not read runtime config: {e}")
            return
        if not isinstance(data, dict):
            return
        prov = str(data.get("provider", "")).lower()
        if prov in _VALID_PROVIDERS:
            self._provider_pref = prov
        priv = str(data.get("private_provider", "")).lower()
        if priv in _VALID_PRIVATE:
            self._private_pref = priv
        nv_model = data.get("nvidia_model")
        if isinstance(nv_model, str) and nv_model.strip():
            self._nvidia_model = nv_model.strip()
        nv_key = data.get("nvidia_key")
        if isinstance(nv_key, str) and nv_key.strip():
            self._nvidia_key = nv_key.strip()
        self._build_nvidia()
        logger.info(
            f"llm: runtime config loaded (provider={self._provider_pref}, "
            f"private={self._private_pref}, nvidia={'set' if self._nvidia else 'none'})"
        )

    def _save_runtime(self) -> None:
        try:
            _RUNTIME_PATH.parent.mkdir(parents=True, exist_ok=True)
            _RUNTIME_PATH.write_text(
                json.dumps({
                    "provider": self._provider_pref,
                    "private_provider": self._private_pref,
                    "nvidia_model": self._nvidia_model,
                    "nvidia_key": self._nvidia_key,
                }),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"llm: could not persist runtime config: {e}")

    def set_nvidia_key(self, key: str) -> bool:
        """Set (or clear) the NVIDIA API key and rebuild the client. An empty
        string disables the NVIDIA provider. Persisted."""
        self._nvidia_key = (key or "").strip()
        self._build_nvidia()
        self._save_runtime()
        logger.info(f"llm: nvidia key {'set' if self._nvidia else 'cleared'}")
        return True

    def set_provider(self, name: str) -> bool:
        """Switch the active brain for normal chat. Persisted. Takes effect
        on the next turn (live sessions resolve the provider per turn)."""
        name = (name or "").lower()
        if name not in _VALID_PROVIDERS:
            return False
        self._provider_pref = name
        self._save_runtime()
        logger.info(f"llm: provider -> {name}")
        return True

    def set_private_provider(self, name: str) -> bool:
        """Choose which provider the private modes (deep/text) run on.
        'local' keeps them on-device (default); 'nvidia' is the opt-in
        cloud testing path. Persisted."""
        name = (name or "").lower()
        if name not in _VALID_PRIVATE:
            return False
        self._private_pref = name
        self._save_runtime()
        logger.info(f"llm: private-mode provider -> {name}")
        return True

    def set_nvidia_model(self, model: str) -> bool:
        """Change which NVIDIA model id is used (e.g. switch between
        llama-3.3-70b-instruct and a Nemotron). Persisted."""
        model = (model or "").strip()
        if not model:
            return False
        self._nvidia_model = model
        self._save_runtime()
        logger.info(f"llm: nvidia model -> {model}")
        return True

    # ── provider selection ──────────────────────────────────────────

    def _local_available(self) -> bool:
        """Cheap cached reachability check for the local model server.
        OpenAI-compatible servers answer GET {base}/models."""
        if not self._local:
            return False
        now = time.time()
        checked_at, available = self._local_probe
        if now - checked_at < LOCAL_PROBE_TTL_SECONDS:
            return available
        ok = False
        try:
            r = httpx.get(f"{self._local_url}/models", timeout=2.0)
            ok = r.status_code == 200
        except Exception:
            ok = False
        self._local_probe = (now, ok)
        return ok

    def active_provider(self) -> tuple:
        """Return (client, model, name) for the provider that should
        answer right now. Honors LLM_PROVIDER; 'auto' prefers the local
        model when reachable and falls back to GPT."""
        pref = self._provider_pref
        if pref == "openai":
            return (self._openai, self._openai_model, "openai")
        if pref == "nvidia":
            return (self._nvidia, self._nvidia_model, "nvidia")
        if pref == "local":
            return (self._local, self._local_model, "local")
        # auto: prefer the on-device model when reachable, else GPT. NVIDIA
        # is never selected automatically — it's an explicit, paid choice.
        if self._local_available():
            return (self._local, self._local_model, "local")
        return (self._openai, self._openai_model, "openai")

    def active_provider_name(self) -> str:
        return self.active_provider()[2]

    def local_available(self) -> bool:
        """Public reachability check for the true on-device local model."""
        return self._local_available()

    def local_provider(self) -> tuple:
        """Return (client, model, name) for the local model explicitly,
        bypassing provider preference. Caller must check local_available()
        first — this returns (None, ...) when no local model is configured."""
        return (self._local, self._local_model, "local")

    # ── private-mode provider (deep/text lock) ──────────────────────

    def private_available(self) -> bool:
        """Whether the private modes (deep/text) can run right now. Resolves
        against the configured private provider: the on-device model's
        reachability by default, or NVIDIA being configured when the user
        has opted the private modes onto it for testing."""
        if self._private_pref == "nvidia":
            return self._nvidia is not None
        return self._local_available()

    def private_provider(self) -> tuple:
        """Return (client, model, name) the private modes run on. NVIDIA only
        when the user explicitly chose it; otherwise the on-device model."""
        if self._private_pref == "nvidia":
            return (self._nvidia, self._nvidia_model, "nvidia")
        return (self._local, self._local_model, "local")

    def runtime_config(self) -> dict:
        """Full brain-selection state for the Settings UI."""
        return {
            "provider": self._provider_pref,
            "private_provider": self._private_pref,
            "active_provider": self.active_provider_name(),
            "providers": {
                "local": {
                    "configured": self._local is not None,
                    "url": self._local_url or None,
                    "model": self._local_model,
                    "reachable": self._local_available(),
                },
                "nvidia": {
                    "configured": self._nvidia is not None,
                    "key_set": bool(self._nvidia_key),
                    "model": self._nvidia_model,
                    "base_url": self._nvidia_url or None,
                },
                "openai": {
                    "configured": self._openai is not None,
                    "model": self._openai_model,
                },
            },
        }

    def status(self) -> dict:
        """Provider status for /health and (later) the WS mode frame."""
        name = self.active_provider_name()
        return {
            "provider_pref": self._provider_pref,
            "private_provider": self._private_pref,
            "active_provider": name,
            "local_url": self._local_url or None,
            "local_reachable": self._local_available(),
            "nvidia_configured": self._nvidia is not None,
            "nvidia_model": self._nvidia_model if self._nvidia else None,
            "fallback_mode": self._fallback_mode,
            "using_fallback": name == "openai" and self._provider_pref not in ("openai",),
        }

    def create_session(
        self,
        seed_history: list[dict] | None = None,
        system_prompt: str | None = None,
    ) -> ChatSession:
        """Create a chat session, optionally seeded with persisted
        history and a personality system prompt. One session per
        WebSocket connection — the session then accumulates further
        history across user turns internally.
        """
        if not self._configured:
            raise RuntimeError(
                "No LLM provider configured. Set OPENAI_API_KEY in "
                "server/api/.env, or start the local model."
            )
        return ChatSession(
            self,
            seed_history=seed_history,
            system_prompt=system_prompt,
        )

    def extract_memories(
        self,
        user_text: str,
        assistant_text: str,
        user_name: str = "the user",
    ) -> list[dict]:
        """Distill durable facts from one conversation turn.

        Returns a list of {content, type, importance}. Runs through the
        SAME active provider as the dialogue, so when the model moves
        local this extraction moves local too — the cloud provider never
        becomes the keeper of long-term memory. Best-effort: any failure
        returns [] rather than raising into the turn.
        """
        client, model, _name = self.active_provider()
        if client is None:
            return []

        prompt = (
            "You extract DURABLE facts worth remembering long-term from a "
            "single conversation turn. Return STRICT JSON: "
            '{"memories": [{"content": str, "type": str, "importance": '
            "number}]}.\n\n"
            "Types: 'user' (who they are, traits, preferences), 'feedback' "
            "(how the assistant should behave), 'project' (ongoing work, "
            "goals, constraints), 'reference' (people, accounts, external "
            "resources).\n"
            "importance: 0.0-1.0 (0.8+ only for clearly significant facts).\n\n"
            "Extract ONLY lasting facts that the USER newly states or asks "
            "to be remembered. IGNORE facts the assistant merely restates, "
            "recalls, or confirms — those are already known. Return an EMPTY "
            "list for: commands (volume, open app, send message), questions, "
            "small talk, transient state, or anything not useful weeks from "
            "now.\n"
            f"Phrase each fact as a concise standalone statement in third "
            f"person, always referring to the user as '{user_name}' (never "
            f"'the user' or 'User') so facts stay consistently worded. Never "
            f"invent facts not present in the text."
        )

        content = (
            f"User said: {user_text}\n"
            f"Assistant replied: {assistant_text}"
        )

        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": content},
                ],
                response_format={"type": "json_object"},
                temperature=0,
            )
            raw = resp.choices[0].message.content or "{}"
            data = json.loads(raw)
            items = data.get("memories", []) if isinstance(data, dict) else []
            out: list[dict] = []
            for it in items:
                if not isinstance(it, dict):
                    continue
                c = (it.get("content") or "").strip()
                if not c:
                    continue
                out.append({
                    "content": c,
                    "type": it.get("type", "user"),
                    "importance": it.get("importance", 0.5),
                })
            return out
        except Exception as e:
            logger.warning(f"memory extraction failed: {e}")
            return []


client = LLMClient()
