/**
 * Slack Block Kit builder for the AI SDR approval message.
 *
 * Posts one message per brief that shows the three variants + scorer's
 * predictions and 4 action buttons. The button click POSTs to a Slack
 * Workflow Builder webhook → Vercel function in apps/bdr-api/ → updates
 * ai_sdr_draft.status + triggers ai-sdr-send.
 *
 * Phase 1: posts the message. Phase 2: wire the webhook.
 */

interface Variant {
  draftId: number;
  variant: "A" | "B" | "C";
  subject: string;
  body: string;
  pillar: string;
  predictedReplyRate: number | null;
  predictedNegative: number | null;
  keyRisk: string | null;
}

interface ApprovalArgs {
  briefId: number;
  accountName: string;
  accountDomain: string;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string;
  painSignal: string;
  personaHook: string;
  pillar: string;
  variants: Variant[];
}

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function variantBlock(v: Variant) {
  const lines = [
    `*Variant ${v.variant}*  ·  pillar: \`${v.pillar}\``,
    `_Subject:_ ${v.subject}`,
    "```",
    v.body,
    "```",
    `_Predicted reply: ${pct(v.predictedReplyRate)}  ·  negative: ${pct(v.predictedNegative)}_`,
    v.keyRisk ? `_Risk: ${v.keyRisk}_` : "",
  ].filter(Boolean);

  return {
    type: "section",
    text: { type: "mrkdwn", text: lines.join("\n") },
  };
}

export function buildApprovalBlocks(args: ApprovalArgs) {
  const headerLines = [
    `*${args.accountName}*  (${args.accountDomain})`,
    args.contactName
      ? `_${args.contactName}, ${args.contactTitle ?? "—"} · ${args.contactEmail ?? "no email"}_`
      : "_no contact identified yet_",
    "",
    `*Pain signal:* ${args.painSignal}`,
    `*Persona hook:* ${args.personaHook}`,
    `*Pillar:* \`${args.pillar}\``,
  ];

  const actionElements = args.variants.map((v) => ({
    type: "button",
    text: { type: "plain_text", text: `Approve ${v.variant}` },
    style: "primary",
    value: String(v.draftId),
    action_id: `approve_draft_${v.draftId}`,
  }));

  actionElements.push({
    type: "button",
    text: { type: "plain_text", text: "Skip / edit in thread" },
    style: "primary",
    value: String(args.briefId),
    action_id: `skip_brief_${args.briefId}`,
  });

  return [
    { type: "section", text: { type: "mrkdwn", text: headerLines.join("\n") } },
    { type: "divider" },
    ...args.variants.flatMap((v) => [variantBlock(v), { type: "divider" }]),
    { type: "actions", elements: actionElements },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `brief_id: ${args.briefId}  ·  reply in-thread to edit before send`,
        },
      ],
    },
  ];
}

export async function postApproval(args: ApprovalArgs): Promise<{ ts: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.AI_SDR_APPROVAL_CHANNEL;

  if (!token || !channel) {
    throw new Error("SLACK_BOT_TOKEN or AI_SDR_APPROVAL_CHANNEL not set");
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text: `AI SDR drafts ready: ${args.accountName}`, // fallback for notifications
      blocks: buildApprovalBlocks(args),
    }),
  });

  const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error}`);
  return { ts: data.ts! };
}
