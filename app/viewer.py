"""Tiny HTML trace viewer. Lists recent traces and renders drafts + evidence."""
from __future__ import annotations

import html
from typing import Iterable

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from app.storage import get_trace, list_traces

router = APIRouter(prefix="/traces", tags=["traces"])

STYLE = """
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
         max-width: 1100px; margin: 24px auto; padding: 0 16px; color: #1c1c1c; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
  th { font-weight: 600; background: #fafafa; }
  a { color: #0a66c2; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .status-drafted { color: #1b7f3a; font-weight: 600; }
  .status-needs_human { color: #b16a00; font-weight: 600; }
  .status-skipped { color: #6b7280; }
  .status-error { color: #b91c1c; font-weight: 600; }
  .layout { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; }
  .draft { background: #f7f7f9; padding: 16px; border-radius: 8px; margin-bottom: 16px; }
  .draft .subj { font-weight: 600; margin-bottom: 8px; }
  .draft .body { white-space: pre-wrap; }
  .evidence { font-size: 13px; }
  .ev { padding: 12px; border-left: 3px solid #0a66c2; background: #fafbff;
        margin-bottom: 12px; border-radius: 0 6px 6px 0; }
  .ev .id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            color: #0a66c2; font-weight: 600; }
  .ev .snippet { color: #444; margin: 6px 0; font-style: italic; }
  .meta { color: #6b7280; font-size: 13px; }
</style>
"""


def _page(title: str, body: str) -> str:
    return f"<!doctype html><html><head><title>{html.escape(title)}</title>{STYLE}</head><body>{body}</body></html>"


@router.get("", response_class=HTMLResponse)
async def index() -> str:
    traces = list_traces(limit=200)
    rows: list[str] = []
    for t in traces:
        status = t["status"] or "running"
        rows.append(
            f"<tr><td><a href='/traces/{html.escape(t['id'])}'>{html.escape(t['id'][:8])}…</a></td>"
            f"<td>{html.escape(t['contact_id'])}</td>"
            f"<td><span class='status-{html.escape(status)}'>{html.escape(status)}</span></td>"
            f"<td class='meta'>{html.escape(t['created_at'])}</td></tr>"
        )
    body = (
        "<h1>Personalization Traces</h1>"
        + ("<table><thead><tr><th>Trace</th><th>Contact</th><th>Status</th><th>Created</th></tr></thead>"
           "<tbody>" + "".join(rows) + "</tbody></table>"
           if rows else "<p class='meta'>No traces yet. POST to /personalize to create one.</p>")
    )
    return _page("Traces", body)


def _render_drafts(drafts: Iterable[dict]) -> str:
    blocks: list[str] = []
    for d in drafts:
        evidence_ids = ", ".join(d.get("evidence_ids") or []) or "—"
        blocks.append(
            f"<div class='draft'>"
            f"<div class='meta'>Email {html.escape(str(d.get('sequence_position', '')))} · "
            f"{html.escape(str(d.get('word_count', '')))} words · evidence: {html.escape(evidence_ids)}</div>"
            f"<div class='subj'>{html.escape(d.get('subject', ''))}</div>"
            f"<div class='body'>{html.escape(d.get('body', ''))}</div>"
            f"</div>"
        )
    return "".join(blocks) or "<p class='meta'>No drafts.</p>"


def _render_evidence(evidence: Iterable[dict]) -> str:
    blocks: list[str] = []
    for e in evidence:
        url = e.get("source_url", "")
        blocks.append(
            f"<div class='ev'>"
            f"<div><span class='id'>{html.escape(e.get('id', ''))}</span> · "
            f"{html.escape(e.get('source_type', ''))} · "
            f"<span class='meta'>{html.escape(e.get('confidence', ''))}</span></div>"
            f"<div>{html.escape(e.get('claim', ''))}</div>"
            f"<div class='snippet'>&ldquo;{html.escape(e.get('snippet', ''))}&rdquo;</div>"
            f"<div><a href='{html.escape(url)}' target='_blank' rel='noopener'>{html.escape(url)}</a></div>"
            f"</div>"
        )
    return "".join(blocks) or "<p class='meta'>No evidence.</p>"


@router.get("/{trace_id}", response_class=HTMLResponse)
async def detail(trace_id: str) -> str:
    t = get_trace(trace_id)
    if not t:
        raise HTTPException(404, "trace not found")
    result = t.get("result") or {}
    payload = t.get("payload") or {}
    contact = (payload.get("contact") or {})
    company = (payload.get("company") or {})

    header = (
        f"<h1>{html.escape(contact.get('first_name', ''))} "
        f"{html.escape(contact.get('last_name', ''))} "
        f"<span class='meta'>· {html.escape(contact.get('title', ''))} at "
        f"{html.escape(company.get('name', ''))}</span></h1>"
        f"<p class='meta'>Trace {html.escape(t['id'])} · "
        f"<span class='status-{html.escape(t['status'] or 'running')}'>{html.escape(t['status'] or 'running')}</span></p>"
    )

    if result.get("skip_reason"):
        header += f"<p class='meta'>Skipped: <strong>{html.escape(result['skip_reason'])}</strong></p>"

    body = (
        header
        + "<div class='layout'>"
        + "<div><h2>Drafts</h2>" + _render_drafts(result.get("drafts") or []) + "</div>"
        + "<div class='evidence'><h2>Evidence</h2>" + _render_evidence(result.get("evidence") or []) + "</div>"
        + "</div>"
        + (f"<h2>Review notes</h2><pre class='meta'>{html.escape(result.get('review_notes') or '')}</pre>"
           if result.get("review_notes") else "")
    )
    return _page(f"Trace {trace_id[:8]}", body)
