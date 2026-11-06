"""Signal-hunter subagent — finds the most recent, relevant trigger event."""
from __future__ import annotations

from app.agents._runner import load_prompt, run_agent
from app.schemas import ClayPayload
from app.tools.exa import exa_server
from app.tools.firecrawl import firecrawl_server


async def hunt_signals(payload: ClayPayload) -> dict:
    system = load_prompt("signal_hunt")
    user = (
        f"Company: {payload.company.name} ({payload.company.domain})\n"
        f"Industry: {payload.company.industry or 'unknown'}\n"
        f"Contact: {payload.contact.first_name} {payload.contact.last_name}, "
        f"{payload.contact.title}\n"
        f"Fit reason: {payload.fit_reason}\n"
        f"Look for hiring triggers, product launches, funding, leadership changes, "
        f"tech changes, partnerships, or public pain signals in the last 90 days."
    )
    return await run_agent(
        system_prompt=system,
        user_message=user,
        mcp_servers={"fc": firecrawl_server, "exa": exa_server},
        allowed_tools=["mcp__fc__*", "mcp__exa__*"],
        max_turns=10,
    )
