"""Writer subagent — drafts 3-step sequence with NO web tools."""
from __future__ import annotations

import json

from app.agents._runner import load_prompt, run_agent
from app.schemas import ClayPayload, EvidenceRecord


async def write_drafts(
    payload: ClayPayload,
    briefs: dict,
    evidence: list[EvidenceRecord],
    repair: list[dict] | None = None,
) -> dict:
    system = (
        load_prompt("voice")
        + "\n\n---\n\n"
        + load_prompt("proof_points")
        + "\n\n---\n\n"
        + load_prompt("writer")
    )

    user_payload = {
        "contact": payload.contact.model_dump(),
        "company": payload.company.model_dump(),
        "icp_tier": payload.icp_tier,
        "fit_reason": payload.fit_reason,
        "briefs": briefs,
        "evidence": [e.model_dump() for e in evidence],
    }
    if repair:
        user_payload["repair_issues"] = repair

    return await run_agent(
        system_prompt=system,
        user_message=json.dumps(user_payload, default=str),
        mcp_servers=None,
        allowed_tools=[],
        max_turns=2,
    )
