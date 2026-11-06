/**
 * ai-sdr-research.ts
 * Trigger.dev v3 task -- Researcher agent in the multi-agent AI SDR pipeline.
 *
 * Flow:
 *   Trigger (per-account)
 *     -> Firecrawl scrape of account domain + careers + blog
 *       -> Claude Sonnet 4.6 (cached system prompt) produces ResearchBrief
 *         -> Insert ai_sdr_brief
 *           -> Trigger ai-sdr-write (skipped if holdout=true)
 *
 * Payload: { account: AccountInput }
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY, DATABASE_URL, FIRECRAWL_API_KEY, AI_SDR_HOLDOUT_PCT
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import FirecrawlApp from "@mendable/firecrawl-js";
import { callClaude, MODELS } from "./ai-sdr/lib/anthropic.js";
import { SystemPrompts } from "./ai-sdr/lib/prompts.js";
import { insertBrief } from "./ai-sdr/lib/neon.js";
import {
  PROMPT_VERSION,
  priorityForScore,
  tierForPillarFit,
  type AccountInput,
  type ResearchBrief,
  type Pillar,
} from "./ai-sdr/types.js";
import { aiSdrWrite } from "./ai-sdr-write.js";

interface ResearchPayload {
  account: AccountInput;
}

const firecrawl = () => {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY not set");
  return new FirecrawlApp({ apiKey: key });
};

async function scrapeAccount(domain: string): Promise<string> {
  const fc = firecrawl();
  const urls = [
    `https://${domain}`,
    `https://${domain}/careers`,
    `https://${domain}/blog`,
    `https://${domain}/engineering`,
  ];
  const chunks: string[] = [];
  for (const url of urls) {
    try {
      const res = (await fc.scrapeUrl(url, {
        formats: ["markdown"],
        onlyMainContent: true,
      })) as { markdown?: string };
      if (res?.markdown) {
        chunks.push(`\n\n## Source: ${url}\n\n${res.markdown.slice(0, 4000)}`);
      }
    } catch (err) {
      logger.warn(`Firecrawl failed for ${url}`, { err: String(err) });
    }
  }
  return chunks.join("\n");
}

function rollHoldout(): boolean {
  const pct = Number(process.env.AI_SDR_HOLDOUT_PCT ?? "20");
  return Math.random() * 100 < pct;
}

export const aiSdrResearch = task({
  id: "ai-sdr-research",
  maxDuration: 300,
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2 },

  run: async (payload: ResearchPayload) => {
    const account = payload.account;
    if (!account?.domain || !account?.name) {
      throw new Error("account.domain and account.name are required");
    }

    logger.info("Researcher starting", { domain: account.domain });

    const holdout = rollHoldout();
    if (holdout) {
      logger.info("Account selected for holdout — skipping writer", { domain: account.domain });
    }

    const scraped = await scrapeAccount(account.domain);
    if (!scraped) {
      logger.warn("No content scraped — proceeding with metadata only", { domain: account.domain });
    }

    const userMessage = [
      `Account: ${account.name}`,
      `Domain: ${account.domain}`,
      account.contactName ? `Known contact: ${account.contactName}, ${account.contactTitle ?? "—"}` : "",
      account.contactEmail ? `Email: ${account.contactEmail}` : "",
      "",
      "Scraped content (markdown, truncated per source):",
      scraped || "(no content scraped)",
      "",
      "Produce the research brief as JSON per the format in the system prompt.",
    ].filter(Boolean).join("\n");

    const claudeRes = await callClaude({
      model: MODELS.research,
      systemPrompt: SystemPrompts.researcher(),
      userMessage,
      maxTokens: 1500,
    });

    logger.info("Claude research call complete", {
      costUsd: claudeRes.costUsd.toFixed(4),
      inputTokens: claudeRes.inputTokens,
      cachedInputTokens: claudeRes.cachedInputTokens,
      outputTokens: claudeRes.outputTokens,
    });

    let parsed: {
      painSignal: string | null;
      personaHook: string;
      evidenceUrls: string[];
      pillar: Pillar;
      intentWeight: number;
      recencyMultiplier: number;
      pillarFit: number;
      contactSuggestion?: { name: string | null; title: string | null; email: string | null };
    };
    try {
      parsed = JSON.parse(claudeRes.text);
    } catch (err) {
      logger.error("Researcher JSON parse failed", { text: claudeRes.text.slice(0, 500) });
      throw new Error("Researcher did not return valid JSON");
    }

    if (!parsed.painSignal || parsed.intentWeight === 0) {
      logger.info("No credible pain signal — routing to BDR raw queue (no draft created)", {
        intentWeight: parsed.intentWeight ?? 0,
      });
      return { status: "no_signal", account: account.name, costUsd: claudeRes.costUsd };
    }

    // Compute final signal score per ai-sdr skill §3 (adapted: pillar_fit
    // replaces firmographic ICP score per Framework §3.8).
    const signalScore = parsed.intentWeight * parsed.recencyMultiplier * parsed.pillarFit;
    const tier = tierForPillarFit(parsed.pillarFit);
    const priority = priorityForScore(signalScore);

    const brief: ResearchBrief = {
      accountDomain: account.domain,
      accountName: account.name,
      contactEmail: account.contactEmail ?? parsed.contactSuggestion?.email ?? undefined,
      contactName: account.contactName ?? parsed.contactSuggestion?.name ?? undefined,
      contactTitle: account.contactTitle ?? parsed.contactSuggestion?.title ?? undefined,
      painSignal: parsed.painSignal,
      personaHook: parsed.personaHook,
      evidenceUrls: parsed.evidenceUrls ?? [],
      pillar: parsed.pillar,
      intentWeight: parsed.intentWeight,
      recencyMultiplier: parsed.recencyMultiplier,
      pillarFit: parsed.pillarFit,
      signalScore,
      tier,
      priority,
      holdout,
      promptVersion: PROMPT_VERSION,
    };

    const briefId = await insertBrief(brief);
    logger.info("Brief inserted", {
      briefId,
      pillar: brief.pillar,
      tier,
      priority,
      signalScore: signalScore.toFixed(1),
      holdout,
    });

    if (!holdout) {
      await aiSdrWrite.trigger({ briefId });
    }

    return {
      status: holdout ? "holdout" : "queued_for_write",
      briefId,
      account: account.name,
      pillar: brief.pillar,
      tier,
      priority,
      signalScore,
      costUsd: claudeRes.costUsd,
    };
  },
});
