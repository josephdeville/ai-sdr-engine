"""FastAPI entrypoint."""
from fastapi import FastAPI

from app.orchestrator import personalize
from app.schemas import ClayPayload, PersonalizationResult
from app.viewer import router as viewer_router
from app.storage import init_db

app = FastAPI(title="ai-sdr-engine", version="0.1.0")

# Init SQLite on import
init_db()

# Trace viewer at /traces
app.include_router(viewer_router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/personalize", response_model=PersonalizationResult)
async def personalize_endpoint(payload: ClayPayload) -> PersonalizationResult:
    return await personalize(payload)
