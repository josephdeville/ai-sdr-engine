import { neon } from "@neondatabase/serverless";
import type {
  ResearchBrief,
  DraftVariant,
  DraftScore,
  ReplyClassification,
  DraftStatus,
} from "../types.js";
import type { AdapterName } from "./email/types.js";

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

export async function insertBrief(b: ResearchBrief): Promise<number> {
  const sql = client();
  const rows = await sql`
    INSERT INTO ai_sdr_brief (
      account_domain, account_name, contact_email, contact_name, contact_title,
      pain_signal, persona_hook, evidence_urls, pillar,
      intent_weight, recency_multiplier, pillar_fit, signal_score, tier, priority,
      holdout, prompt_version
    ) VALUES (
      ${b.accountDomain}, ${b.accountName}, ${b.contactEmail ?? null},
      ${b.contactName ?? null}, ${b.contactTitle ?? null},
      ${b.painSignal}, ${b.personaHook}, ${JSON.stringify(b.evidenceUrls)}::jsonb,
      ${b.pillar},
      ${b.intentWeight}, ${b.recencyMultiplier}, ${b.pillarFit}, ${b.signalScore},
      ${b.tier}, ${b.priority},
      ${b.holdout}, ${b.promptVersion}
    )
    ON CONFLICT (account_domain, (DATE(created_at))) DO UPDATE
      SET pain_signal = EXCLUDED.pain_signal,
          persona_hook = EXCLUDED.persona_hook,
          evidence_urls = EXCLUDED.evidence_urls,
          intent_weight = EXCLUDED.intent_weight,
          recency_multiplier = EXCLUDED.recency_multiplier,
          pillar_fit = EXCLUDED.pillar_fit,
          signal_score = EXCLUDED.signal_score,
          tier = EXCLUDED.tier,
          priority = EXCLUDED.priority
    RETURNING id
  `;
  return (rows[0] as { id: number }).id;
}

export async function insertDraft(
  briefId: number,
  v: DraftVariant,
  promptVersion: string,
): Promise<number> {
  const sql = client();
  const rows = await sql`
    INSERT INTO ai_sdr_draft (brief_id, variant, subject, body, pillar, prompt_version)
    VALUES (${briefId}, ${v.variant}, ${v.subject}, ${v.body}, ${v.pillar}, ${promptVersion})
    ON CONFLICT (brief_id, variant) DO UPDATE
      SET subject = EXCLUDED.subject, body = EXCLUDED.body
    RETURNING id
  `;
  return (rows[0] as { id: number }).id;
}

export async function insertScore(s: DraftScore, promptVersion: string): Promise<void> {
  const sql = client();
  await sql`
    INSERT INTO ai_sdr_score (
      draft_id, predicted_reply_rate, predicted_negative, key_risk, rationale, prompt_version
    ) VALUES (
      ${s.draftId}, ${s.predictedReplyRate}, ${s.predictedNegative},
      ${s.keyRisk}, ${s.rationale}, ${promptVersion}
    )
    ON CONFLICT (draft_id) DO UPDATE
      SET predicted_reply_rate = EXCLUDED.predicted_reply_rate,
          predicted_negative = EXCLUDED.predicted_negative,
          key_risk = EXCLUDED.key_risk,
          rationale = EXCLUDED.rationale
  `;
}

export async function updateDraftStatus(
  draftId: number,
  status: DraftStatus,
  approvedBy?: string,
): Promise<void> {
  const sql = client();
  if (approvedBy) {
    await sql`
      UPDATE ai_sdr_draft
      SET status = ${status}, approved_by = ${approvedBy}, approved_at = now()
      WHERE id = ${draftId}
    `;
  } else {
    await sql`UPDATE ai_sdr_draft SET status = ${status} WHERE id = ${draftId}`;
  }
}

export async function getDraftWithBrief(draftId: number) {
  const sql = client();
  const rows = await sql`
    SELECT
      d.id AS draft_id, d.variant, d.subject, d.body, d.pillar AS draft_pillar,
      d.status, d.approved_by,
      b.id AS brief_id, b.account_domain, b.account_name,
      b.contact_email, b.contact_name, b.contact_title,
      b.pain_signal, b.persona_hook, b.pillar AS brief_pillar
    FROM ai_sdr_draft d
    JOIN ai_sdr_brief b ON b.id = d.brief_id
    WHERE d.id = ${draftId}
  `;
  return rows[0] ?? null;
}

export async function getDraftsForBrief(briefId: number) {
  const sql = client();
  return sql`
    SELECT d.id AS draft_id, d.variant, d.subject, d.body, d.pillar,
           s.predicted_reply_rate, s.predicted_negative, s.key_risk
    FROM ai_sdr_draft d
    LEFT JOIN ai_sdr_score s ON s.draft_id = d.id
    WHERE d.brief_id = ${briefId}
    ORDER BY d.variant
  `;
}

export async function logSend(args: {
  draftId: number;
  adapter: AdapterName;
  providerMsgId: string | null;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: "queued" | "sent" | "bounced" | "failed";
  errorMessage?: string;
}): Promise<number> {
  const sql = client();
  const rows = await sql`
    INSERT INTO ai_sdr_send (
      draft_id, adapter, provider_msg_id, to_email, from_email, subject, body,
      status, error_message, sent_at
    ) VALUES (
      ${args.draftId}, ${args.adapter}, ${args.providerMsgId},
      ${args.toEmail}, ${args.fromEmail}, ${args.subject}, ${args.body},
      ${args.status}, ${args.errorMessage ?? null},
      ${args.status === "sent" ? new Date().toISOString() : null}
    )
    RETURNING id
  `;
  return (rows[0] as { id: number }).id;
}

export async function logReply(args: {
  sendId: number | null;
  fromEmail: string;
  subject: string;
  body: string;
  classification: ReplyClassification;
  promptVersion: string;
}): Promise<number> {
  const sql = client();
  const rows = await sql`
    INSERT INTO ai_sdr_reply (
      send_id, from_email, subject, body, classification,
      drafted_response, escalated_to, rationale, prompt_version
    ) VALUES (
      ${args.sendId}, ${args.fromEmail}, ${args.subject}, ${args.body},
      ${args.classification.classification},
      ${args.classification.draftedResponse},
      ${args.classification.escalatedTo},
      ${args.classification.rationale},
      ${args.promptVersion}
    )
    RETURNING id
  `;
  return (rows[0] as { id: number }).id;
}

export async function findSendByProviderMsgId(
  adapter: AdapterName,
  providerMsgId: string,
): Promise<number | null> {
  const sql = client();
  const rows = await sql`
    SELECT id FROM ai_sdr_send WHERE adapter = ${adapter} AND provider_msg_id = ${providerMsgId}
  `;
  return rows[0] ? (rows[0] as { id: number }).id : null;
}
