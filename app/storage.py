"""SQLite trace store. No ORM — sqlite3 stdlib is enough."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.schemas import ClayPayload, PersonalizationResult

DB_PATH = Path("traces.db")


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    with conn as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS traces (
                id TEXT PRIMARY KEY,
                contact_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                result_json TEXT,
                status TEXT
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_traces_created ON traces(created_at DESC)")
    conn.close()


def _conn() -> sqlite3.Connection:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def start_trace(trace_id: str, payload: ClayPayload) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO traces (id, contact_id, created_at, payload_json) VALUES (?, ?, ?, ?)",
            (
                trace_id,
                payload.contact.contact_id,
                datetime.now(timezone.utc).isoformat(),
                payload.model_dump_json(),
            ),
        )


def finish_trace(trace_id: str, result: PersonalizationResult) -> None:
    with _conn() as c:
        c.execute(
            "UPDATE traces SET result_json = ?, status = ? WHERE id = ?",
            (result.model_dump_json(), result.status, trace_id),
        )


def list_traces(limit: int = 100) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, contact_id, created_at, status FROM traces "
            "ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_trace(trace_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM traces WHERE id = ?", (trace_id,)
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "contact_id": row["contact_id"],
        "created_at": row["created_at"],
        "status": row["status"],
        "payload": json.loads(row["payload_json"]) if row["payload_json"] else None,
        "result": json.loads(row["result_json"]) if row["result_json"] else None,
    }
