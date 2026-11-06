/**
 * ai-sdr-write.ts
 * Trigger.dev v3 task -- Writer agent in the multi-agent AI SDR pipeline.
 *
 * Flow:
 *   Trigger (on brief insert)
 *     -> Load brief from Neon
 *       -> Claude Sonnet 4.6 (cached system prompt = message house + writer rules)
 *         -> Insert 3 ai_sdr_draft rows (status=pending_score)
 *           -> Trigger ai-sdr-score
 *
 * Payload: { briefId: number }
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY, DATABASE_URL
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import { neon } from "@neondatabase/serverless";
import { callClaude, MODELS } from "./ai-sdr/lib/anthropic.js";
import { SystemPrompts } from "./ai-sdr/lib/prompts.js";
import { insertDraft } from "./ai-sdr/lib/neon.js";
import { PROMPT_VERSION, type DraftVariant, type Pillar } from "./ai-sdr/types.js";
import { aiSdrScore } from "./ai-sdr-score.js";

interface WritePayload {
  briefId: number;
}

interface BriefRow {
  id: number;
  account_domain: string;
  account_name: string;
  contact_name: string | null;
  contact_title: string | null;
  pain_signal: string;
  persona_hook: string;
  pillar: Pillar;
  evidence_urls: string[];
}

async function loadBrief(briefId: number): Promise<BriefRow | null> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT id, account_domain, account_name, contact_name, contact_title,
           pain_signal, persona_hook, pillar, evidence_urls
    FROM ai_sdr_brief WHERE id = ${briefId}
  `;
  return (rows[0] as BriefRow | undefined) ?? null;
}

export const aiSdrWrite = task({
  id: "ai-sdr-write",
  maxDuration: 180,
  retry: { maxAttempts: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 30000, factor: 2 },

  run: async (payload: WritePayload) => {
    const brief = await loadBrief(payload.briefId);
    if (!brief) throw new Error(`Brief ${payload.briefId} not found`);

    logger.info("Writer starting", { briefId: brief.id, account: brief.account_name });

    const userMessage = [
      "Brief:",
      `Account: ${brief.account_name} (${brief.account_domain})`,
      brief.contact_name
        ? `Contact: ${brief.contact_name}, ${brief.contact_title ?? "—"}`
        : "Contact: not identified",
      `Pain signal: ${brief.pain_signal}`,
      `Persona hook: ${brief.persona_hook}`,
      `Pillar (do not override): ${brief.pillar}`,
      `Evidence URLs: ${(brief.evidence_urls || []).join(", ") || "—"}`,
      "",
      "Produce 3 variants as JSON per the format in the system prompt.",
    ].join("\n");

    const claudeRes = await callClaude({
      model: MODELS.write,
      systemPrompt: SystemPrompts.writer(),
      userMessage,
      maxTokens: 2000,
    });

    logger.info("Writer Claude call complete", {
      costUsd: claudeRes.costUsd.toFixed(4),
      cachedInputTokens: claudeRes.cachedInputTokens,
    });

    let parsed: { variants: DraftVariant[]; pillar: Pillar };
    try {
      parsed = JSON.parse(claudeRes.text);
    } catch {
      logger.error("Writer JSON parse failed", { text: claudeRes.text.slice(0, 500) });
      throw new Error("Writer did not return valid JSON");
    }

    if (!Array.isArray(parsed.variants) || parsed.variants.length !== 3) {
      throw new Error(`Writer returned ${parsed.variants?.length ?? 0} variants; expected 3`);
    }

    const draftIds: number[] = [];
    for (const v of parsed.variants) {
      const id = await insertDraft(
        brief.id,
        { variant: v.variant, subject: v.subject, body: v.body, pillar: brief.pillar },
        PROMPT_VERSION,
      );
      draftIds.push(id);
    }

    logger.info("Drafts inserted", { briefId: brief.id, draftIds });

    await aiSdrScore.trigger({ briefId: brief.id });

    return {
      status: "queued_for_score",
      briefId: brief.id,
      draftIds,
      costUsd: claudeRes.costUsd,
    };
  },
});
