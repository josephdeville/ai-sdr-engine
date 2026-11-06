/**
 * AI SDR shared types.
 *
 * Discipline note (Framework §3.8): ResearchBrief intentionally omits
 * headcount, ARR, industry, vertical, close_date, stage, amount, owner.
 * The writer/scorer must not segment on those fields.
 */

export type Pillar = "centralize" | "unlock" | "improve";
export type Tier = "T1" | "T2" | "T3";
export type Priority = "P0" | "P1" | "P2" | "P3";

export interface AccountInput {
  domain: string;
  name: string;
  contactEmail?: string;
  contactName?: string;
  contactTitle?: string;
  /** Send-time adapter selection (named → Gmail, others → Smartlead). Distinct
   *  from the brief's ICP tier, which is operational-signal-driven. */
  sendTier?: "named" | "mid-market" | "smb";
}

/**
 * Signal scoring (adapted from skill §3 — intent × recency × ICP fit).
 * Framework §3.8 forbids firmographic ICP segmentation, so pillarFit replaces
 * the skill's firmographic-tier ICP score.
 */
export interface SignalScore {
  /** Skill §3 intent weight: pricing_visit=10, demo_request=10, competitor_eval=9,
   *  funding=7, hiring_for_category=7, content_dl=5, linkedin_engagement=3,
   *  job_posting_match=3. Operational-signal flavors only. */
  intentWeight: number;
  /** 3.0 = last 24h, 2.0 = last 7d, 1.0 = last 30d, 0.5 = older */
  recencyMultiplier: number;
  /** 3.0 = signal aligns to all 3 value pillars (e.g. centralize+unlock+improve),
   *  1.5 = 1–2 pillars, 0.5 = weak/peripheral. */
  pillarFit: number;
  /** intentWeight × recencyMultiplier × pillarFit */
  signalScore: number;
  tier: Tier;
  priority: Priority;
}

export interface ResearchBrief extends SignalScore {
  accountDomain: string;
  accountName: string;
  contactEmail?: string;
  contactName?: string;
  contactTitle?: string;
  painSignal: string;
  personaHook: string;
  evidenceUrls: string[];
  pillar: Pillar;
  holdout: boolean;
  promptVersion: string;
}

/**
 * Map signal score → routing priority per skill §3:
 *   >50 = P0 (immediate), 25–50 = P1 (same day), 10–25 = P2 (within 72hr), <10 = P3 (nurture)
 */
export function priorityForScore(score: number): Priority {
  if (score > 50) return "P0";
  if (score >= 25) return "P1";
  if (score >= 10) return "P2";
  return "P3";
}

export function tierForPillarFit(pillarFit: number): Tier {
  if (pillarFit >= 2.5) return "T1";
  if (pillarFit >= 1.0) return "T2";
  return "T3";
}

export interface DraftVariant {
  variant: "A" | "B" | "C";
  subject: string;
  body: string;
  pillar: Pillar;
}

export interface DraftScore {
  draftId: number;
  predictedReplyRate: number;
  predictedNegative: number;
  keyRisk: string;
  rationale: string;
}

export type DraftStatus =
  | "pending_score"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "failed";

export type ReplyClass =
  | "positive"
  | "objection"
  | "ooo"
  | "unsubscribe"
  | "wrong_person"
  | "human_escalate";

export interface ReplyClassification {
  classification: ReplyClass;
  draftedResponse: string | null;
  escalatedTo: string | null;
  rationale: string;
}

export const PROMPT_VERSION = "v2-2026-05-27";
