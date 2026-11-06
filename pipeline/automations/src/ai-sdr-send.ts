/**
 * ai-sdr-send.ts
 * Trigger.dev v3 task -- Sender agent in the multi-agent AI SDR pipeline.
 *
 * Triggered by the Slack approval webhook (Phase 2: apps/bdr-api/) once a BDR
 * clicks "Approve N" on the approval message. Loads the approved draft, picks
 * the right email adapter for the account tier, sends, and writes to
 * ai_sdr_send.
 *
 * Flow:
 *   Trigger (on draft approval)
 *     -> Load draft + brief (with contact email)
 *       -> Router picks Smartlead (mid-market/smb) or Gmail (named)
 *         -> Adapter.send()
 *           -> logSend()
 *             -> Update draft.status = sent | failed
 *
 * Payload: { draftId: number, approvedBy: string }
 *
 * Env vars required:
 *   DATABASE_URL, SLACK_BOT_TOKEN,
 *   REACHINBOX_API_KEY + REACHINBOX_CAMPAIGN_ID  (for ReachInbox adapter)
 *   REACHINBOX_FROM_ADDRESS                       (optional, for send log)
 */

import { task, logger } from "@trigger.dev/sdk/v3";
import { getDraftWithBrief, logSend, updateDraftStatus } from "./ai-sdr/lib/neon.js";
import { pickAdapter } from "./ai-sdr/lib/email/router.js";

interface SendPayload {
  draftId: number;
  approvedBy: string;
}

export const aiSdrSend = task({
  id: "ai-sdr-send",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, factor: 2 },

  run: async (payload: SendPayload) => {
    const row = (await getDraftWithBrief(payload.draftId)) as any;
    if (!row) throw new Error(`Draft ${payload.draftId} not found`);

    if (!row.contact_email) {
      logger.warn("No contact email — cannot send", { draftId: payload.draftId });
      await updateDraftStatus(payload.draftId, "failed");
      return { status: "no_contact_email", draftId: payload.draftId };
    }

    // tier comes from enrichment_cache later; default to mid-market for now.
    const adapter = pickAdapter(undefined);
    logger.info("Sending with adapter", { adapter: adapter.name, to: row.contact_email });

    // ReachInbox sends from the campaign's configured mailbox; this is just
    // the address recorded on the activity log.
    const fromEmail = process.env.REACHINBOX_FROM_ADDRESS ?? "outbound@example.com";

    const result = await adapter.send({
      toEmail: row.contact_email,
      toName: row.contact_name ?? undefined,
      fromEmail,
      fromName: payload.approvedBy,
      subject: row.subject,
      body: row.body,
    });

    const sendId = await logSend({
      draftId: payload.draftId,
      adapter: adapter.name,
      providerMsgId: result.providerMsgId,
      toEmail: row.contact_email,
      fromEmail,
      subject: row.subject,
      body: row.body,
      status: result.status === "sent" ? "sent" : result.status === "queued" ? "queued" : "failed",
      errorMessage: result.errorMessage,
    });

    await updateDraftStatus(
      payload.draftId,
      result.status === "failed" ? "failed" : "sent",
      payload.approvedBy,
    );

    logger.info("Send complete", {
      sendId,
      status: result.status,
      adapter: adapter.name,
      providerMsgId: result.providerMsgId,
    });

    return { status: result.status, sendId, adapter: adapter.name };
  },
});
