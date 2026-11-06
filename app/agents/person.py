"""Person research subagent — gathers verifiable signals about the contact."""
from __future__ import annotations

from app.agents._runner import load_prompt, run_agent
from app.schemas import ClayPayload
from app.tools.exa import exa_server
from app.tools.firecrawl import firecrawl_server


async def research_person(payload: ClayPayload) -> dict:
    system = load_prompt("person_research")
    user = (
        f"Contact: {payload.contact.first_name} {payload.contact.last_name}\n"
        f"Title: {payload.contact.title}\n"
        f"Company: {payload.company.name}\n"
        f"LinkedIn: {payload.contact.linkedin_url or 'unknown'}\n"
        f"Seniority: {payload.contact.seniority or 'unknown'}\n"
    )
    return await run_agent(
        system_prompt=system,
        user_message=user,
        mcp_servers={"fc": firecrawl_server, "exa": exa_server},
        allowed_tools=["mcp__fc__*", "mcp__exa__*"],
        max_turns=14,
    )
