"""Reviewer subagent — validates drafts against evidence + voice. NO web tools."""
from __future__ import annotations

import json

from app.agents._runner import load_prompt, run_agent
from app.schemas import EvidenceRecord


async def review(drafts: list[dict], evidence: list[EvidenceRecord]) -> dict:
    system = load_prompt("reviewer")
    user_payload = {
        "drafts": drafts,
        "evidence": [e.model_dump() for e in evidence],
    }
    return await run_agent(
        system_prompt=system,
        user_message=json.dumps(user_payload, default=str),
        mcp_servers=None,
        allowed_tools=[],
        max_turns=1,
    )
