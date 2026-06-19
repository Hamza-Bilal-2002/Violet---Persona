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

    LOG_LEVEL: str = "INFO"
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Local embedding service (server/embed). Defaults to localhost for
    # running the api outside compose; docker-compose overrides this
    # with the on-network host (http://embed:8005).
    EMBED_URL: str = "http://localhost:8005"

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
