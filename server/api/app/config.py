import json
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# Agent identity (name, user's name, personality) is the single
# source of truth at /config/agent.json (mounted in docker-compose
# from ./config/). Load eagerly at module import; the backend
# restarts cheaply when the file changes.

_DEFAULT_AGENT = {
    "name": "Violet",
    "userName": "Hamza",
    "personality": {
        "archetype": "cute tsundere",
        "summary": "Light tsundere — playful surface, caring underneath.",
        "voiceGender": "female",
    },
}


def _load_agent_config() -> dict:
    candidates = [
        Path("/app/config/agent.json"),
        Path(__file__).resolve().parent.parent.parent / "config" / "agent.json",
    ]
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            continue
        except json.JSONDecodeError as e:
            print(f"[config] agent.json at {path} is malformed: {e}")
            return _DEFAULT_AGENT
    print(f"[config] agent.json not found in {candidates}; using defaults")
    return _DEFAULT_AGENT


AGENT = _load_agent_config()


class Settings(BaseSettings):
    OPENAI_API_KEY: str = ""

    # gpt-4o-mini is the cost-efficient default: $0.15 / $0.60 per
    # million input/output tokens, reliable function calling, fast
    # first-token latency. For short conversational replies this
    # costs cents per day at heavy use. Override OPENAI_MODEL in
    # .env to pick a different model (gpt-4.1-mini, gpt-4o, etc.).
    OPENAI_MODEL: str = "gpt-4o-mini"

    # ── Provider selection (local model + GPT fallback) ──────────────
    #
    # 'auto'   → use the local model when reachable, else GPT.
    # 'local'  → force the local model (errors if unreachable).
    # 'openai' → force GPT (current testing default behavior).
    #
    # Ollama (and llama.cpp/LM Studio) expose an OpenAI-compatible API,
    # so the local provider is just the openai SDK pointed at a
    # different base_url. The local model isn't running yet, so 'auto'
    # falls through to GPT until LOCAL_LLM_URL answers.
    LLM_PROVIDER: str = "auto"
    LOCAL_LLM_URL: str = "http://ollama:11434/v1"
    LOCAL_LLM_MODEL: str = "llama3"

    # ── NVIDIA NIM (cloud-hosted, OpenAI-compatible) ─────────────────
    #
    # A third "brain" option alongside the local model and OpenAI. NVIDIA
    # exposes its hosted models (Llama 3.3 70B, Nemotron, etc.) through an
    # OpenAI-compatible endpoint, so it's just the openai SDK pointed at a
    # different base_url + an nvapi-… key. Useful as a far stronger Tier-1
    # than a CPU-bound local model. Selected at runtime from Settings;
    # never used automatically (auto still prefers local → OpenAI).
    NVIDIA_API_KEY: str = ""
    NVIDIA_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    NVIDIA_MODEL: str = "meta/llama-3.3-70b-instruct"

    # What the api is allowed to do when GPT (not the local model) is
    # answering. 'full' keeps tools + RAG + memory (used for testing
    # now). 'basic' strips them so the cloud provider never touches
    # memory/documents in production.
    FALLBACK_MODE: str = "full"

    LOG_LEVEL: str = "INFO"
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Local embedding service (server/embed). Defaults to localhost for
    # running the api outside compose; docker-compose overrides this
    # with the on-network host (http://embed:8005).
    EMBED_URL: str = "http://localhost:8005"

    # TTS service (server/tts). Used to list which Piper voices are
    # actually installed so the Settings voice picker only offers real
    # ones. localhost default for running outside compose; compose
    # overrides with the on-network host (http://tts:8004).
    TTS_URL: str = "http://localhost:8004"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def agent_name(self) -> str:
        return AGENT.get("name", "Violet")

    @property
    def user_name(self) -> str:
        return AGENT.get("userName", "Hamza")

    @property
    def personality_summary(self) -> str:
        p = AGENT.get("personality") or {}
        return p.get("summary", "")


settings = Settings()
