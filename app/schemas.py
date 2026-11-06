"""Pydantic models. The contract for Clay <-> service and the trace store."""
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, HttpUrl, Field


# ---------- inbound ----------

class ContactIn(BaseModel):
    contact_id: str
    first_name: str
    last_name: str
    title: str
    email: str
    linkedin_url: HttpUrl | None = None
    seniority: str | None = None


class CompanyIn(BaseModel):
    company_id: str
    name: str
    domain: HttpUrl
    industry: str | None = None
    employee_count: int | None = None
    tech_stack: list[str] = Field(default_factory=list)
    recent_funding: str | None = None


class ClayPayload(BaseModel):
    contact: ContactIn
    company: CompanyIn
    campaign_id: str
    icp_tier: Literal["A", "B", "C"]
    fit_reason: str
    enrichment_notes: str = ""


# ---------- evidence + drafts ----------

SourceType = Literal[
    "company_site", "blog", "news", "podcast",
    "linkedin", "github", "press_release",
]


class EvidenceRecord(BaseModel):
    id: str  # "ev_001"
    claim: str
    source_url: HttpUrl
    source_type: SourceType
    snippet: str  # <=300 chars, quoted
    retrieved_at: str  # ISO
    confidence: Literal["high", "medium", "low"]


class EmailDraft(BaseModel):
    sequence_position: int  # 1 | 2 | 3
    subject: str
    body: str
    evidence_ids: list[str] = Field(default_factory=list)
    evidence_map: dict[str, str] = Field(default_factory=dict)
    word_count: int = 0


# ---------- outbound ----------

Status = Literal["drafted", "needs_human", "skipped", "error"]


class PersonalizationResult(BaseModel):
    contact_id: str
    status: Status
    skip_reason: str | None = None
    drafts: list[EmailDraft] = Field(default_factory=list)
    evidence: list[EvidenceRecord] = Field(default_factory=list)
    review_notes: str | None = None
    trace_id: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
