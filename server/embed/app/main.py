"""
Embedding service.

A tiny FastAPI shim over a local sentence-embedding model (fastembed /
onnxruntime, CPU). It exists so the api service can turn text into
vectors for the long-term memory store without any cloud dependency —
fully offline, matching the local-LLM direction.

Endpoints:
  POST /embed   {"texts": [...], "mode": "passage"|"query"}  -> vectors
  GET  /health  liveness + model/dim

bge-small-en-v1.5 is a 384-dim retrieval model. It performs best when
stored documents and search queries are embedded differently: passages
plain, queries prefixed with a short retrieval instruction. fastembed
handles that split via passage_embed() vs query_embed(), exposed here
through the `mode` field. The memory store embeds saved facts as
"passage" and the user's incoming turn as "query".

The model is lazy-loaded on first request so uvicorn --reload doesn't
load it twice and process startup stays cheap. The build step in the
Dockerfile only populates the on-disk cache.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from pydantic import BaseModel

# ---- config -----------------------------------------------------------------

MODEL_NAME = "BAAI/bge-small-en-v1.5"
MODEL_DIM = 384

# ---- app --------------------------------------------------------------------

app = FastAPI(title="Persona Embedding Service", version="0.1.0")

# Called container-to-container by the api, but keep CORS open so the
# endpoint is reachable from a browser/devtools for debugging too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- model (lazy) -----------------------------------------------------------

_model = None


def get_model():
    """Lazy-load the TextEmbedding singleton on first use."""
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        logger.info(f"loading embedding model: {MODEL_NAME}")
        _model = TextEmbedding(model_name=MODEL_NAME)
        logger.info("embedding model ready")
    return _model


# ---- schema -----------------------------------------------------------------

class EmbedRequest(BaseModel):
    texts: list[str]
    # "passage" for stored documents/facts, "query" for search queries.
    mode: str = "passage"


# ---- routes -----------------------------------------------------------------

@app.get("/")
async def root():
    return {"name": "persona-embed", "version": "0.1.0", "model": MODEL_NAME}


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_NAME, "dim": MODEL_DIM}


@app.post("/embed")
async def embed(req: EmbedRequest):
    """Return one vector per input text. Empty input → empty list."""
    texts = [t for t in (req.texts or []) if t and t.strip()]
    if not texts:
        return {"model": MODEL_NAME, "dim": MODEL_DIM, "embeddings": []}

    model = get_model()

    # bge wants the retrieval instruction on queries only. fastembed's
    # query_embed() applies it; passage_embed()/embed() do not.
    if req.mode == "query":
        vectors = model.query_embed(texts)
    else:
        vectors = model.passage_embed(texts)

    # fastembed yields numpy arrays; tolist() makes them JSON-safe.
    embeddings = [vec.tolist() for vec in vectors]

    logger.info(f"embed: {len(embeddings)} text(s), mode={req.mode}")
    return {"model": MODEL_NAME, "dim": MODEL_DIM, "embeddings": embeddings}
