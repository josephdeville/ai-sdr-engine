"""Company research subagent — gathers verifiable firmographic + activity facts."""
from __future__ import annotations

from app.agents._runner import load_prompt, run_agent
from app.schemas import ClayPayload
from app.tools.exa import exa_server
from app.tools.firecrawl import firecrawl_server


async def research_company(payload: ClayPayload) -> dict:
    system = load_prompt("company_research")
    user = (
        f"Company: {payload.company.name}\n"
        f"Domain: {payload.company.domain}\n"
        f"Industry: {payload.company.industry or 'unknown'}\n"
        f"Tech stack hint: {', '.join(payload.company.tech_stack) or 'unknown'}\n"
        f"ICP tier: {payload.icp_tier}\n"
        f"Fit reason: {payload.fit_reason}\n"
    )
    return await run_agent(
        system_prompt=system,
        user_message=user,
        mcp_servers={"fc": firecrawl_server, "exa": exa_server},
        allowed_tools=["mcp__fc__*", "mcp__exa__*"],
        max_turns=14,
    )
