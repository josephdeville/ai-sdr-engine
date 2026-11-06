"""Shared helper: build options, run a one-shot agent turn, parse JSON.

This module isolates the Claude Agent SDK surface so individual agents stay tiny.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# Import lazily so test suites can run without the SDK installed.
try:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
    SDK_AVAILABLE = True
except ImportError:  # pragma: no cover
    SDK_AVAILABLE = False
    ClaudeAgentOptions = None  # type: ignore[assignment]
    ClaudeSDKClient = None  # type: ignore[assignment]

MODEL = "claude-sonnet-4-6"
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(name: str) -> str:
    """Load a prompt by filename (without extension)."""
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.MULTILINE)


def parse_json(text: str) -> dict:
    """Pull a JSON object out of model output. Tries fenced block, then raw."""
    if not text:
        return {}
    # Prefer fenced ```json blocks.
    m = _JSON_BLOCK_RE.search(text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # Fall back to first { ... } that parses.
    start = text.find("{")
    while start != -1:
        for end in range(len(text), start, -1):
            candidate = text[start:end]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue
        start = text.find("{", start + 1)
    return {}


def _extract_text(messages: list[Any]) -> str:
    """Walk SDK messages and pull out assistant text content."""
    chunks: list[str] = []
    for m in messages:
        # The SDK uses message objects with `.content` lists of blocks.
        content = getattr(m, "content", None)
        if content is None and isinstance(m, dict):
            content = m.get("content")
        if not content:
            continue
        if isinstance(content, str):
            chunks.append(content)
            continue
        for block in content:
            text = getattr(block, "text", None)
            if text is None and isinstance(block, dict):
                text = block.get("text")
            if text:
                chunks.append(text)
    return "\n".join(chunks)


async def run_agent(
    *,
    system_prompt: str,
    user_message: str,
    mcp_servers: dict | None = None,
    allowed_tools: list[str] | None = None,
    max_turns: int = 2,
) -> dict:
    """Run a single agent loop and return the parsed JSON object.

    Returns an empty dict if the SDK isn't installed (so tests run offline).
    """
    if not SDK_AVAILABLE:
        return {}

    options = ClaudeAgentOptions(
        model=MODEL,
        system_prompt=system_prompt,
        mcp_servers=mcp_servers or {},
        allowed_tools=allowed_tools or [],
        max_turns=max_turns,
    )

    collected: list[Any] = []
    async with ClaudeSDKClient(options=options) as client:
        await client.query(user_message)
        async for msg in client.receive_response():
            collected.append(msg)

    text = _extract_text(collected)
    return parse_json(text)
