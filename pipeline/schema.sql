-- AI SDR pipeline tables
-- Run: psql $DATABASE_URL -f pipeline/schema.sql

CREATE TABLE IF NOT EXISTS ai_sdr_brief (
  id                  BIGSERIAL PRIMARY KEY,
  account_domain      TEXT NOT NULL,
  account_name        TEXT NOT NULL,
  contact_email       TEXT,
  contact_name        TEXT,
  contact_title       TEXT,
  pain_signal         TEXT NOT NULL,
  persona_hook        TEXT NOT NULL,
  evidence_urls       JSONB NOT NULL DEFAULT '[]'::jsonb,
  pillar              TEXT NOT NULL CHECK (pillar IN ('centralize', 'unlock', 'improve')),
  -- Signal scoring (skill §3: intent × recency × pillar-fit). Domain variant:
  -- pillar_fit replaces firmographic ICP score (Framework §3.8 forbids firmographics).
  intent_weight       NUMERIC(4,1) NOT NULL DEFAULT 0,
  recency_multiplier  NUMERIC(3,1) NOT NULL DEFAULT 1.0,
  pillar_fit          NUMERIC(3,1) NOT NULL DEFAULT 0.5,
  signal_score        NUMERIC(6,2) NOT NULL DEFAULT 0,
  tier                CHAR(2) NOT NULL DEFAULT 'T3' CHECK (tier IN ('T1','T2','T3')),
  priority            CHAR(2) NOT NULL DEFAULT 'P3' CHECK (priority IN ('P0','P1','P2','P3')),
  holdout             BOOLEAN NOT NULL DEFAULT false,
  prompt_version      TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_domain, DATE(created_at))
);

CREATE INDEX IF NOT EXISTS idx_brief_created  ON ai_sdr_brief (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brief_holdout  ON ai_sdr_brief (holdout, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brief_priority ON ai_sdr_brief (priority, signal_score DESC);
CREATE INDEX IF NOT EXISTS idx_brief_tier     ON ai_sdr_brief (tier, signal_score DESC);

CREATE TABLE IF NOT EXISTS ai_sdr_draft (
  id              BIGSERIAL PRIMARY KEY,
  brief_id        BIGINT NOT NULL REFERENCES ai_sdr_brief(id) ON DELETE CASCADE,
  variant         CHAR(1) NOT NULL CHECK (variant IN ('A', 'B', 'C')),
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  pillar          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_score'
                  CHECK (status IN ('pending_score', 'pending_approval',
                                    'approved', 'rejected', 'sent', 'failed')),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  prompt_version  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brief_id, variant)
);

CREATE INDEX IF NOT EXISTS idx_draft_brief ON ai_sdr_draft (brief_id);
CREATE INDEX IF NOT EXISTS idx_draft_status ON ai_sdr_draft (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_sdr_score (
  id                    BIGSERIAL PRIMARY KEY,
  draft_id              BIGINT NOT NULL REFERENCES ai_sdr_draft(id) ON DELETE CASCADE,
  predicted_reply_rate  NUMERIC(4,3) NOT NULL CHECK (predicted_reply_rate BETWEEN 0 AND 1),
  predicted_negative    NUMERIC(4,3) NOT NULL CHECK (predicted_negative BETWEEN 0 AND 1),
  key_risk              TEXT NOT NULL,
  rationale             TEXT NOT NULL,
  prompt_version        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id)
);

CREATE TABLE IF NOT EXISTS ai_sdr_send (
  id              BIGSERIAL PRIMARY KEY,
  draft_id        BIGINT NOT NULL REFERENCES ai_sdr_draft(id) ON DELETE CASCADE,
  adapter         TEXT NOT NULL CHECK (adapter IN ('reachinbox', 'smartlead', 'gmail')),
  provider_msg_id TEXT,
  to_email        TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sent', 'bounced', 'failed')),
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_send_status ON ai_sdr_send (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_send_provider ON ai_sdr_send (adapter, provider_msg_id);

CREATE TABLE IF NOT EXISTS ai_sdr_reply (
  id                BIGSERIAL PRIMARY KEY,
  send_id           BIGINT REFERENCES ai_sdr_send(id) ON DELETE SET NULL,
  from_email        TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  classification    TEXT NOT NULL
                    CHECK (classification IN ('positive', 'objection',
                           'ooo', 'unsubscribe', 'wrong_person', 'human_escalate')),
  drafted_response  TEXT,
  escalated_to      TEXT,
  rationale         TEXT,
  prompt_version    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reply_send ON ai_sdr_reply (send_id);
CREATE INDEX IF NOT EXISTS idx_reply_class ON ai_sdr_reply (classification, created_at DESC);
