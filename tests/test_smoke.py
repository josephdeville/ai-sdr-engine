"""Smoke tests for the orchestrator in DRY_RUN mode.

These do NOT require API keys. They exercise the deterministic gates and the
JSON-shape contract end-to-end with mock-friendly research agents.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

# Force DRY_RUN before importing app.* so tools pick it up.
os.environ.setdefault("DRY_RUN", "1")

from app.guardrails import (  # noqa: E402
    CAPS,
    should_skip,
    validate_drafts,
    word_count,
)
from app.schemas import ClayPayload, PersonalizationResult  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "clay_payload.json"


def _load_payload(**overrides) -> ClayPayload:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data.update(overrides)
    return ClayPayload.model_validate(data)


# ---------- guardrails ----------

def test_word_count():
    assert word_count("hello world") == 2
    assert word_count("") == 0


def test_validate_drafts_catches_banned_phrase():
    drafts = [
        {"sequence_position": 1, "subject": "hi",
         "body": "Just wanted to circle back on this."},
    ]
    issues = validate_drafts(drafts)
    joined = " ".join(i["issue"] for i in issues)
    assert "banned:just wanted to" in joined
    assert "banned:circle back" in joined


def test_validate_drafts_catches_length_violation():
    long_body = " ".join(["word"] * (CAPS[1] + 5))
    drafts = [{"sequence_position": 1, "subject": "ok", "body": long_body}]
    issues = validate_drafts(drafts)
    assert any("body_too_long" in i["issue"] for i in issues)


def test_validate_drafts_passes_clean_draft():
    drafts = [
        {"sequence_position": 1, "subject": "shipping with claims tied to evidence",
         "body": "Saw your Q1 launch. Quick reply if useful."},
    ]
    assert validate_drafts(drafts) == []


# ---------- should_skip ----------

def test_should_skip_tier_c():
    p = _load_payload(icp_tier="C")
    assert should_skip(p) == "tier_c"


def test_should_skip_missing_fit_reason():
    p = _load_payload(fit_reason="")
    assert should_skip(p) == "missing_fit_reason"


def test_should_skip_passes_tier_a_with_fit():
    p = _load_payload()
    assert should_skip(p) is None


# ---------- orchestrator (returns a PersonalizationResult shape) ----------

def test_orchestrator_returns_result_shape():
    """In DRY_RUN with no SDK, researchers return {} and the orchestrator skips
    on 'insufficient_evidence'. We're just verifying the contract shape here."""
    from app.orchestrator import personalize  # imported here so DRY_RUN env applies

    p = _load_payload()
    result = asyncio.run(personalize(p))
    assert isinstance(result, PersonalizationResult)
    assert result.contact_id == p.contact.contact_id
    assert result.status in {"drafted", "needs_human", "skipped", "error"}
    assert result.trace_id


def test_orchestrator_skips_tier_c():
    from app.orchestrator import personalize

    p = _load_payload(icp_tier="C")
    result = asyncio.run(personalize(p))
    assert result.status == "skipped"
    assert result.skip_reason == "tier_c"
