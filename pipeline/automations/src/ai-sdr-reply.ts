/**
 * ai-sdr-reply.ts
 * Trigger.dev v3 task -- Reply-handler agent in the multi-agent AI SDR pipeline.
 *
 * Triggered by an inbound email webhook (Phase 2: route from Smartlead reply
 * webhook + Gmail Pub/Sub watch). Classifies the reply, optionally drafts a
 * response, and escalates ambiguous / sensitive replies to a BDR via Slack.
 *
 * Flow:
 *   Trigger (webhook)
 *     -> Match reply to ai_sdr_send via provider_msg_id or thread headers
 *       -> Claude Sonnet 4.6 (cached system prompt) classifies + drafts
 *         -> logReply()
 *           -> If positive/objection + draftedResponse → post to Slack thread
 *               for BDR to send (Phase 2: auto-send option behind a flag)
 *             -> If human_escalate/unsubscribe → Slack ping the BDR
 *
 * Payload: { fromEmail, subject, body, providerMsgId?, threadId? }
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY, DATABASE_URL, SLACK_BOT_TOKEN, AI_SDR_APPROVAL_CHANNEL
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import { callClaude, MODELS } from "./ai-sdr/lib/anthropic.js";
import { SystemPrompts } from "./ai-sdr/lib/prompts.js";
import { findSendByProviderMsgId, logReply } from "./ai-sdr/lib/neon.js";
import { PROMPT_VERSION, type ReplyClassification } from "./ai-sdr/types.js";

interface ReplyPayload {
  fromEmail: string;
  subject: string;
  body: string;
  providerMsgId?: string;
  adapter?: "smartlead" | "gmail";
}

async function pingSlack(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.AI_SDR_APPROVAL_CHANNEL;
  if (!token || !channel) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
  } catch (err) {
    logger.warn("Slack ping failed", { err: String(err) });
  }
}

export const aiSdrReply = task({
  id: "ai-sdr-reply",
  maxDuration: 120,
  retry: { maxAttempts: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 30000, factor: 2 },

  run: async (payload: ReplyPayload) => {
    logger.info("Reply handler starting", {
      from: payload.fromEmail,
      subject: payload.subject.slice(0, 80),
    });

    let sendId: number | null = null;
    if (payload.providerMsgId && payload.adapter) {
      sendId = await findSendByProviderMsgId(payload.adapter, payload.providerMsgId);
    }

    const userMessage = [
      `Inbound reply from: ${payload.fromEmail}`,
      `Subject: ${payload.subject}`,
      "Body:",
      payload.body.slice(0, 4000),
      "",
      "Classify and (if appropriate) draft a response per the format in the system prompt.",
    ].join("\n");

    const claudeRes = await callClaude({
      model: MODELS.reply,
      systemPrompt: SystemPrompts.replyClassifier(),
      userMessage,
      maxTokens: 800,
    });

    logger.info("Reply Claude call complete", { costUsd: claudeRes.costUsd.toFixed(4) });

    let parsed: ReplyClassification;
    try {
      parsed = JSON.parse(claudeRes.text);
    } catch {
      logger.error("Reply classifier JSON parse failed", { text: claudeRes.text.slice(0, 500) });
      throw new Error("Reply classifier did not return valid JSON");
    }

    const replyId = await logReply({
      sendId,
      fromEmail: payload.fromEmail,
      subject: payload.subject,
      body: payload.body,
      classification: parsed,
      promptVersion: PROMPT_VERSION,
    });

    logger.info("Reply logged", { replyId, classification: parsed.classification });

    if (parsed.classification === "unsubscribe") {
      await pingSlack(
        `:warning: *UNSUBSCRIBE* from ${payload.fromEmail} — escalated to ${parsed.escalatedTo ?? "compliance@example.com"}. reply_id: ${replyId}`,
      );
    } else if (parsed.classification === "human_escalate") {
      await pingSlack(
        `:eyes: Reply needs human review from ${payload.fromEmail}. Reason: ${parsed.rationale}. reply_id: ${replyId}`,
      );
    } else if (parsed.draftedResponse) {
      await pingSlack(
        `*Reply drafted* (${parsed.classification}) for ${payload.fromEmail}\n\`\`\`${parsed.draftedResponse}\`\`\`\nreply_id: ${replyId}  ·  rationale: ${parsed.rationale}`,
      );
    }

    return {
      status: "classified",
      replyId,
      classification: parsed.classification,
      costUsd: claudeRes.costUsd,
    };
  },
});
