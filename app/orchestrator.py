"""The main personalize() entry point.

Steps:
1. should_skip() — deterministic gates (tier, suppression, recency, fit_reason).
2. Fan out 3 research subagents in parallel.
3. merge_evidence() — assign deterministic ev_001… ids.
4. Second skip gate: <3 evidence records OR no signal <=90d.
5. write_drafts() — tool-less.
6. review() — tool-less.
7. If reviewer blocks: ONE repair pass back through writer.
8. Deterministic validate_drafts(); status = drafted if both pass else needs_human.
9. Persist trace + return.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

from app import storage
from app.agents.company import research_company
from app.agents.person import research_person
from app.agents.reviewer import review
from app.agents.signals import hunt_signals
from app.agents.writer import write_drafts
from app.guardrails import should_skip, validate_drafts, word_count
from app.schemas import (
    ClayPayload,
    EmailDraft,
    EvidenceRecord,
    PersonalizationResult,
)


def _now() -> str:
    return datetime.utcnow().isoformat()


def _skipped(payload: ClayPayload, trace_id: str, reason: str,
             evidence: list[EvidenceRecord] | None = None) -> PersonalizationResult:
    result = PersonalizationResult(
        contact_id=payload.contact.contact_id,
        status="skipped",
        skip_reason=reason,
        evidence=evidence or [],
        trace_id=trace_id,
    )
    storage.finish_trace(trace_id, result)
    return result


def _has_recent_signal(signals_brief: dict, max_age_days: int = 90) -> bool:
    """True if signals_brief['signals'] contains any signal with date <= max_age_days old."""
    signals = signals_brief.get("signals") or []
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    for s in signals:
        date_str = s.get("date")
        if not date_str:
            continue
        try:
            d = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            if d >= cutoff:
                return True
        except (ValueError, TypeError):
            continue
    return False


def merge_evidence(briefs: list[dict]) -> list[EvidenceRecord]:
    """Take researcher outputs and flatten into a deduped EvidenceRecord list.

    Each brief may have:
      - company_facts: [{fact, source_url, snippet, date_seen, confidence}, ...]
      - person_facts:  [{fact, source_url, snippet, ...}, ...]
      - signals:       [{type, description, source_url, snippet, date, ...}, ...]

    Dedupe by source_url. Assign deterministic ev_001, ev_002, ... ids.
    """
    seen_urls: dict[str, str] = {}  # url -> ev_id
    records: list[EvidenceRecord] = []
    counter = 1

    def _add(item: dict, source_type: str, claim_key: str = "fact"):
        nonlocal counter
        url = item.get("source_url")
        if not url:
            return
        if url in seen_urls:
            return
        ev_id = f"ev_{counter:03d}"
        seen_urls[url] = ev_id
        counter += 1
        try:
            records.append(EvidenceRecord(
                id=ev_id,
                claim=item.get(claim_key) or item.get("description") or "",
                source_url=url,
                source_type=source_type,  # type: ignore[arg-type]
                snippet=(item.get("snippet") or "")[:300],
                retrieved_at=_now(),
                confidence=item.get("confidence") or "medium",  # type: ignore[arg-type]
            ))
        except Exception:
            # Skip records that don't validate (bad URL, etc.)
            pass

    for brief in briefs:
        for f in brief.get("company_facts") or []:
            _add(f, "company_site", "fact")
        for f in brief.get("person_facts") or []:
            _add(f, "linkedin", "fact")
        for s in brief.get("signals") or []:
            _add(s, "news", "description")

    return records


async def personalize(payload: ClayPayload) -> PersonalizationResult:
    trace_id = str(uuid.uuid4())
    storage.start_trace(trace_id, payload)

    # Gate 1 — cheap deterministic skips before spending research $$.
    if reason := should_skip(payload):
        return _skipped(payload, trace_id, reason)

    # Fan out research in parallel.
    try:
        company, person, signals = await asyncio.gather(
            research_company(payload),
            research_person(payload),
            hunt_signals(payload),
        )
    except Exception as exc:  # noqa: BLE001
        result = PersonalizationResult(
            contact_id=payload.contact.contact_id,
            status="error",
            skip_reason=f"research_error: {exc}",
            trace_id=trace_id,
        )
        storage.finish_trace(trace_id, result)
        return result

    evidence = merge_evidence([company, person, signals])

    # Gate 2 — insufficient evidence to personalize.
    if len(evidence) < 3 or not _has_recent_signal(signals):
        return _skipped(payload, trace_id, "insufficient_evidence", evidence)

    briefs = {"company": company, "person": person, "signals": signals}

    # Writer pass.
    drafts_raw = await write_drafts(payload, briefs, evidence)
    if drafts_raw.get("skip_reason"):
        return _skipped(payload, trace_id, drafts_raw["skip_reason"], evidence)

    # Reviewer pass.
    verdict = await review(drafts_raw.get("drafts", []), evidence)

    # ONE repair pass if reviewer blocks.
    if not verdict.get("passed") and verdict.get("severity") == "block":
        drafts_raw = await write_drafts(payload, briefs, evidence, repair=verdict.get("issues"))
        verdict = await review(drafts_raw.get("drafts", []), evidence)

    # Deterministic guardrails — belt and suspenders.
    raw_drafts = drafts_raw.get("drafts", [])
    hard_issues = validate_drafts(raw_drafts)

    drafts = [
        EmailDraft(
            sequence_position=d["sequence_position"],
            subject=d["subject"],
            body=d["body"],
            evidence_ids=d.get("evidence_ids", []),
            evidence_map=d.get("evidence_map", {}),
            word_count=word_count(d["body"]),
        )
        for d in raw_drafts
    ]

    status = "drafted" if verdict.get("passed") and not hard_issues else "needs_human"

    result = PersonalizationResult(
        contact_id=payload.contact.contact_id,
        status=status,
        drafts=drafts,
        evidence=evidence,
        review_notes=json.dumps({"verdict": verdict, "hard": hard_issues}),
        trace_id=trace_id,
    )
    storage.finish_trace(trace_id, result)
    return result
