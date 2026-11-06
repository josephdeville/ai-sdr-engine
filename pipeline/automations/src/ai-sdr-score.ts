/**
 * ai-sdr-score.ts
 * Trigger.dev v3 task -- Scorer agent in the multi-agent AI SDR pipeline.
 *
 * Inspired by the market-response-modeler command pattern: predicts reply
 * rate, negative-response probability, and key risk per variant. Outputs
 * feed the Slack approval message so the BDR sees signal before clicking.
 *
 * Flow:
 *   Trigger (on writer complete)
 *     -> Load brief + 3 drafts
 *       -> Claude Sonnet 4.6 (cached system prompt) scores all 3 at once
 *         -> Insert ai_sdr_score rows
 *           -> Update drafts to pending_approval
 *             -> Post Slack approval message
 *
 * Payload: { briefId: number }
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY, DATABASE_URL, SLACK_BOT_TOKEN, AI_SDR_APPROVAL_CHANNEL
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import { neon } from "@neondatabase/serverless";
import { callClaude, MODELS } from "./ai-sdr/lib/anthropic.js";
import { SystemPrompts } from "./ai-sdr/lib/prompts.js";
import { insertScore, updateDraftStatus } from "./ai-sdr/lib/neon.js";
import { postApproval } from "./ai-sdr/lib/slack.js";
import { PROMPT_VERSION } from "./ai-sdr/types.js";

interface ScorePayload {
  briefId: number;
}

interface ScoreVariant {
  variant: "A" | "B" | "C";
  predictedReplyRate: number;
  predictedNegative: number;
  keyRisk: string;
  rationale: string;
}

export const aiSdrScore = task({
  id: "ai-sdr-score",
  maxDuration: 180,
  retry: { maxAttempts: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 30000, factor: 2 },

  run: async (payload: ScorePayload) => {
    const sql = neon(process.env.DATABASE_URL!);

    const briefRows = await sql`
      SELECT id, account_domain, account_name, contact_email, contact_name,
             contact_title, pain_signal, persona_hook, pillar
      FROM ai_sdr_brief WHERE id = ${payload.briefId}
    `;
    const brief = briefRows[0] as any;
    if (!brief) throw new Error(`Brief ${payload.briefId} not found`);

    const draftRows = await sql`
      SELECT id, variant, subject, body, pillar
      FROM ai_sdr_draft WHERE brief_id = ${payload.briefId}
      ORDER BY variant
    `;
    if (draftRows.length !== 3) {
      throw new Error(`Expected 3 drafts for brief ${payload.briefId}, got ${draftRows.length}`);
    }

    logger.info("Scorer starting", { briefId: brief.id, drafts: draftRows.length });

    const userMessage = [
      "Brief:",
      `Account: ${brief.account_name} (${brief.account_domain})`,
      brief.contact_name ? `Contact: ${brief.contact_name}, ${brief.contact_title ?? "—"}` : "Contact: not identified",
      `Pain signal: ${brief.pain_signal}`,
      `Persona hook: ${brief.persona_hook}`,
      `Pillar: ${brief.pillar}`,
      "",
      "Drafts:",
      ...draftRows.map((d: any) =>
        [`---`, `Variant ${d.variant}`, `Subject: ${d.subject}`, `Body:`, d.body].join("\n"),
      ),
      "",
      "Score all three as JSON per the format in the system prompt.",
    ].join("\n");

    const claudeRes = await callClaude({
      model: MODELS.score,
      systemPrompt: SystemPrompts.scorer(),
      userMessage,
      maxTokens: 1500,
    });

    logger.info("Scorer Claude call complete", { costUsd: claudeRes.costUsd.toFixed(4) });

    let parsed: { scores: ScoreVariant[] };
    try {
      parsed = JSON.parse(claudeRes.text);
    } catch {
      logger.error("Scorer JSON parse failed", { text: claudeRes.text.slice(0, 500) });
      throw new Error("Scorer did not return valid JSON");
    }

    if (!Array.isArray(parsed.scores) || parsed.scores.length !== 3) {
      throw new Error(`Scorer returned ${parsed.scores?.length ?? 0} scores; expected 3`);
    }

    for (const s of parsed.scores) {
      const draft = draftRows.find((d: any) => d.variant === s.variant) as any;
      if (!draft) continue;
      await insertScore(
        {
          draftId: draft.id,
          predictedReplyRate: s.predictedReplyRate,
          predictedNegative: s.predictedNegative,
          keyRisk: s.keyRisk,
          rationale: s.rationale,
        },
        PROMPT_VERSION,
      );
      await updateDraftStatus(draft.id, "pending_approval");
    }

    const variantsForSlack = draftRows.map((d: any) => {
      const s = parsed.scores.find((x) => x.variant === d.variant);
      return {
        draftId: d.id,
        variant: d.variant as "A" | "B" | "C",
        subject: d.subject,
        body: d.body,
        pillar: d.pillar,
        predictedReplyRate: s?.predictedReplyRate ?? null,
        predictedNegative: s?.predictedNegative ?? null,
        keyRisk: s?.keyRisk ?? null,
      };
    });

    const slackRes = await postApproval({
      briefId: brief.id,
      accountName: brief.account_name,
      accountDomain: brief.account_domain,
      contactName: brief.contact_name ?? undefined,
      contactTitle: brief.contact_title ?? undefined,
      contactEmail: brief.contact_email ?? undefined,
      painSignal: brief.pain_signal,
      personaHook: brief.persona_hook,
      pillar: brief.pillar,
      variants: variantsForSlack,
    });

    logger.info("Approval posted to Slack", { ts: slackRes.ts });

    return {
      status: "awaiting_approval",
      briefId: brief.id,
      slackTs: slackRes.ts,
      costUsd: claudeRes.costUsd,
    };
  },
});
