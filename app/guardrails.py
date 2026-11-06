"""Deterministic guardrails. Belt-and-suspenders to the LLM reviewer."""
from __future__ import annotations

import re

from app.schemas import ClayPayload


# Phrases that flag generic / corporate / spammy writing.
BANNED = [
    "just wanted to",
    "hope this finds",
    "quick question",
    "circle back",
    "touch base",
    "synergy",
    "unlock",
    "game-changer",
    "revolutionize",
    "in today's",
    "in the era of",
    "world-class",
    "best-in-class",
]

# Word count caps per sequence position.
CAPS = {1: 90, 2: 60, 3: 40}
MAX_SUBJECT = 55


_WORD_RE = re.compile(r"\b\w+\b")


def word_count(text: str) -> int:
    return len(_WORD_RE.findall(text or ""))


# ---------- TODO: hook into Clay / HubSpot ----------

def is_suppressed(email: str) -> bool:
    """Stub. Replace with a real suppression-list lookup (HubSpot or Clay)."""
    return False


def recently_contacted(email: str, days: int = 30) -> bool:
    """Stub. Replace with a recent-activity lookup against your CRM."""
    return False


# ---------- gates ----------

def should_skip(payload: ClayPayload) -> str | None:
    """Return a skip reason string, or None to proceed."""
    if payload.icp_tier == "C":
        return "tier_c"
    if is_suppressed(payload.contact.email):
        return "suppression"
    if recently_contacted(payload.contact.email):
        return "recent_send_30d"
    if not payload.fit_reason:
        return "missing_fit_reason"
    return None


def validate_drafts(drafts: list[dict]) -> list[dict]:
    """Deterministic checks. Returns list of issues; empty list = pass."""
    issues: list[dict] = []
    for d in drafts:
        pos = d.get("sequence_position")
        subject = d.get("subject", "")
        body = d.get("body", "")

        if len(subject) > MAX_SUBJECT:
            issues.append({"pos": pos, "issue": f"subject_too_long ({len(subject)}>{MAX_SUBJECT})"})

        cap = CAPS.get(pos)
        if cap is not None:
            wc = word_count(body)
            if wc > cap:
                issues.append({"pos": pos, "issue": f"body_too_long ({wc}>{cap})"})

        low = (subject + " " + body).lower()
        for phrase in BANNED:
            if phrase in low:
                issues.append({"pos": pos, "issue": f"banned:{phrase}"})
    return issues
