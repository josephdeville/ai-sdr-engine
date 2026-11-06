"""In-process MCP server exposing Firecrawl scrape + search.

Honors DRY_RUN=1 to return fixtures from tests/fixtures/firecrawl/.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx

try:
    from claude_agent_sdk import tool, create_sdk_mcp_server
except ImportError:  # pragma: no cover
    def tool(name, description, schema):  # type: ignore[no-redef]
        def deco(fn):
            return fn
        return deco

    def create_sdk_mcp_server(name, version, tools):  # type: ignore[no-redef]
        return {"name": name, "version": version, "tools": tools}


FIRECRAWL_BASE = "https://api.firecrawl.dev/v1"
MAX_CHARS = 8000
FIXTURES = Path(__file__).parent.parent.parent / "tests" / "fixtures" / "firecrawl"


def _dry_run() -> bool:
    return os.getenv("DRY_RUN") == "1"


def _api_key() -> str:
    key = os.getenv("FIRECRAWL_API_KEY")
    if not key:
        raise RuntimeError("FIRECRAWL_API_KEY not set")
    return key


def _text(payload: str) -> dict:
    return {"content": [{"type": "text", "text": payload[:MAX_CHARS] or "[empty]"}]}


def _fixture(kind: str, key: str) -> dict:
    """Return a recorded fixture if one exists, else a stub."""
    safe = "".join(c if c.isalnum() else "_" for c in key)[:80]
    path = FIXTURES / f"{kind}__{safe}.json"
    if path.exists():
        return _text(path.read_text(encoding="utf-8"))
    stub = json.dumps({
        "source_url": key,
        "snippet": f"[DRY_RUN fixture for {kind}({key})]",
        "content": "Sample dry-run content. Replace with a recorded fixture for realism.",
    })
    return _text(stub)


@tool(
    "firecrawl_scrape",
    "Scrape one URL into clean markdown. Capped at 8k chars. Always includes source_url.",
    {"url": str},
)
async def firecrawl_scrape(args: dict) -> dict:
    url = args["url"]
    if _dry_run():
        return _fixture("scrape", url)
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.post(
            f"{FIRECRAWL_BASE}/scrape",
            headers={"Authorization": f"Bearer {_api_key()}"},
            json={"url": url, "formats": ["markdown"]},
        )
    data = (r.json().get("data") or {}) if r.is_success else {}
    md = data.get("markdown") or ""
    return _text(json.dumps({"source_url": url, "markdown": md[:MAX_CHARS]}))


@tool(
    "firecrawl_search",
    "Web search. Returns top 5 results with title, url, snippet.",
    {"query": str},
)
async def firecrawl_search(args: dict) -> dict:
    query = args["query"]
    if _dry_run():
        return _fixture("search", query)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{FIRECRAWL_BASE}/search",
            headers={"Authorization": f"Bearer {_api_key()}"},
            json={"query": query, "limit": 5},
        )
    results = (r.json().get("data") or []) if r.is_success else []
    trimmed = [
        {
            "source_url": item.get("url"),
            "title": item.get("title"),
            "snippet": (item.get("description") or "")[:300],
        }
        for item in results[:5]
    ]
    return _text(json.dumps(trimmed))


firecrawl_server = create_sdk_mcp_server(
    "firecrawl",
    "1.0.0",
    [firecrawl_scrape, firecrawl_search],
)
