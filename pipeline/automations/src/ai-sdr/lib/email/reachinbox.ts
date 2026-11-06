import type { EmailAdapter, SendArgs, SendResult } from "./types.js";

/**
 * ReachInbox adapter.
 *
 * ReachInbox has no transactional "send one email" endpoint. The model is:
 * add a lead to a campaign, and the campaign's own scheduler sends to it.
 * Campaign templates are shared across all leads — there is no per-lead
 * subject/body. So we carry each AI-written email as custom variables
 * (ai_subject / ai_body) and the campaign template must reference them:
 *
 *     Subject: {{ai_subject}}
 *     Body:    {{ai_body}}
 *
 * Therefore send() returns status "queued" on success (not "sent") — the
 * actual delivery happens on ReachInbox's schedule. Starting the campaign is
 * a separate, deliberate action and is intentionally NOT done here.
 *
 * Endpoint:  POST https://api.reachinbox.ai/api/v1/leads/add
 * Auth:      Authorization: Bearer <REACHINBOX_API_KEY>
 * Rate limit: 5 req/sec (one call per send(); the Trigger.dev task serializes).
 *
 * UNVERIFIED against a live account — confirm with one real lead before volume:
 *   1. Custom vars (ai_subject/ai_body) are sent flat on the lead object here.
 *      ReachInbox may instead want them nested (e.g. under `attributes`).
 *   2. That ReachInbox renders merge variables in the *subject* line, not just
 *      the body. If subjects don't interpolate, AI subjects won't apply.
 *   3. The response shape for the created lead id (parsed defensively below).
 */

const REACHINBOX_BASE = "https://api.reachinbox.ai";

interface ReachInboxLead {
  email: string;
  firstName?: string;
  lastName?: string;
  // Custom merge variables referenced by the campaign template.
  ai_subject: string;
  ai_body: string;
}

function splitName(full?: string): { firstName?: string; lastName?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function extractLeadId(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, any>;
    const candidate =
      obj.id ?? obj.leadId ?? obj.data?.id ?? obj.data?.leadId ?? obj.data?.[0]?.id;
    if (candidate != null) return String(candidate);
  }
  return fallback;
}

export const reachinboxAdapter: EmailAdapter = {
  name: "reachinbox",

  async send(args: SendArgs): Promise<SendResult> {
    const apiKey = process.env.REACHINBOX_API_KEY;
    const campaignId = process.env.REACHINBOX_CAMPAIGN_ID;

    if (!apiKey || !campaignId) {
      return {
        adapter: "reachinbox",
        providerMsgId: null,
        status: "failed",
        errorMessage:
          "REACHINBOX_API_KEY or REACHINBOX_CAMPAIGN_ID not set",
      };
    }

    const { firstName, lastName } = splitName(args.toName);
    const lead: ReachInboxLead = {
      email: args.toEmail,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      ai_subject: args.subject,
      ai_body: args.body,
    };

    const body = {
      campaignId: Number(campaignId),
      leads: [lead],
      newCoreVariables: ["ai_subject", "ai_body"],
      duplicates: [],
    };

    let res: Response;
    try {
      res = await fetch(`${REACHINBOX_BASE}/api/v1/leads/add`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        adapter: "reachinbox",
        providerMsgId: null,
        status: "failed",
        errorMessage: `ReachInbox request failed: ${(err as Error).message}`,
      };
    }

    const text = await res.text();
    if (!res.ok) {
      return {
        adapter: "reachinbox",
        providerMsgId: null,
        status: "failed",
        errorMessage: `ReachInbox ${res.status}: ${text.slice(0, 500)}`,
      };
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON 2xx — treat as queued, fall back to email as the id.
    }

    return {
      adapter: "reachinbox",
      providerMsgId: extractLeadId(parsed, args.toEmail),
      status: "queued",
    };
  },
};
