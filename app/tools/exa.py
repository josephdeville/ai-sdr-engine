"""In-process MCP server exposing Exa neural search + content fetch.

Honors DRY_RUN=1 to return fixtures from tests/fixtures/exa/.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
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


EXA_BASE = "https://api.exa.ai"
MAX_CHARS = 8000
FIXTURES = Path(__file__).parent.parent.parent / "tests" / "fixtures" / "exa"


def _dry_run() -> bool:
    return os.getenv("DRY_RUN") == "1"


def _api_key() -> str:
    key = os.getenv("EXA_API_KEY")
    if not key:
        raise RuntimeError("EXA_API_KEY not set")
    return key


def _text(payload: str) -> dict:
    return {"content": [{"type": "text", "text": payload[:MAX_CHARS] or "[empty]"}]}


def _fixture(kind: str, key: str) -> dict:
    safe = "".join(c if c.isalnum() else "_" for c in key)[:80]
    path = FIXTURES / f"{kind}__{safe}.json"
    if path.exists():
        return _text(path.read_text(encoding="utf-8"))
    stub = json.dumps({
        "source_url": key,
        "snippet": f"[DRY_RUN fixture for {kind}({key})]",
    })
    return _text(stub)


@tool(
    "exa_search",
    "Neural web search. Pass num_results (default 5) and recency_days (default 90).",
    {"query": str, "num_results": int, "recency_days": int},
)
async def exa_search(args: dict) -> dict:
    query = args["query"]
    num_results = int(args.get("num_results") or 5)
    recency_days = int(args.get("recency_days") or 90)
    if _dry_run():
        return _fixture("search", query)
    start_published_date = (datetime.utcnow() - timedelta(days=recency_days)).date().isoformat()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{EXA_BASE}/search",
            headers={"x-api-key": _api_key(), "content-type": "application/json"},
            json={
                "query": query,
                "numResults": num_results,
                "startPublishedDate": start_published_date,
                "useAutoprompt": True,
                "type": "neural",
            },
        )
    results = (r.json().get("results") or []) if r.is_success else []
    trimmed = [
        {
            "source_url": item.get("url"),
            "title": item.get("title"),
            "published": item.get("publishedDate"),
            "snippet": (item.get("text") or "")[:300],
        }
        for item in results[:num_results]
    ]
    return _text(json.dumps(trimmed))


@tool(
    "exa_get_contents",
    "Fetch parsed text + highlights for a URL.",
    {"url": str},
)
async def exa_get_contents(args: dict) -> dict:
    url = args["url"]
    if _dry_run():
        return _fixture("contents", url)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{EXA_BASE}/contents",
            headers={"x-api-key": _api_key(), "content-type": "application/json"},
            json={"ids": [url], "text": True, "highlights": True},
        )
    results = (r.json().get("results") or []) if r.is_success else []
    if not results:
        return _text(json.dumps({"source_url": url, "text": "[empty]"}))
    item = results[0]
    return _text(json.dumps({
        "source_url": url,
        "title": item.get("title"),
        "text": (item.get("text") or "")[:MAX_CHARS],
        "highlights": item.get("highlights") or [],
    }))


@tool(
    "exa_find_similar",
    "Given a URL, find similar pages (e.g. more posts by the same author).",
    {"url": str},
)
async def exa_find_similar(args: dict) -> dict:
    url = args["url"]
    if _dry_run():
        return _fixture("similar", url)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{EXA_BASE}/findSimilar",
            headers={"x-api-key": _api_key(), "content-type": "application/json"},
            json={"url": url, "numResults": 5},
        )
    results = (r.json().get("results") or []) if r.is_success else []
    trimmed = [
        {"source_url": x.get("url"), "title": x.get("title"), "snippet": (x.get("text") or "")[:300]}
        for x in results[:5]
    ]
    return _text(json.dumps(trimmed))


exa_server = create_sdk_mcp_server(
    "exa",
    "1.0.0",
    [exa_search, exa_get_contents, exa_find_similar],
)
