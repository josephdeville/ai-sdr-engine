# AI SDR — Multi-Agent Outbound Pipeline

Multi-agent outbound SDR pipeline built with Trigger.dev and Neon Postgres. Five specialized agents move an
account from initial signal to responded email without an SDR composing
each message manually. A human BDR approves every draft via Slack before
anything ships.

## Pipeline

```
┌──────────┐   ┌────────┐   ┌────────┐   ┌────────────┐   ┌────────┐   ┌──────────────┐
│Researcher│→ │ Writer │→ │ Scorer │→ │Slack approve│→ │ Sender │→ │Reply handler │
└──────────┘   └────────┘   └────────┘   └────────────┘   └────────┘   └──────────────┘
   Neon         Neon         Neon         Block Kit       ReachInbox,
   + Firecrawl  + cache      + cache      buttons         Smartlead, Gmail
```

| # | Agent | Trigger | Reads | Writes | Model |
|---|---|---|---|---|---|
| 1 | Researcher | cron 6am CT | `enrichment_cache` (Clay-fed) + Firecrawl | `ai_sdr_brief` | Sonnet 4.6, cached system prompt |
| 2 | Writer | on `ai_sdr_brief` insert | brief + message-house positioning | `ai_sdr_draft` (3 variants) | Sonnet 4.6, cached |
| 3 | Scorer | on `ai_sdr_draft` insert | drafts + segment context | `ai_sdr_score` | Sonnet 4.6, cached |
| 4 | Slack approve | on scoring complete | drafts + scores | Slack message → BDR clicks "approve N" / "edit" / "skip" | n/a (human) |
| 5 | Sender | on `approved` state | approved draft + account tier | sends via ReachInbox/Smartlead/Gmail; writes `ai_sdr_send` | Haiku 4.5 |
| 6 | Reply handler | inbound webhook | reply email + thread | classifies + drafts response; writes `ai_sdr_reply`; pings BDR if escalate | Sonnet 4.6 |

## Discipline (GTM Engineering Framework)

- **Cost gate.** At 200 accounts/day with cached system prompts:
  - Research: ~$2.40 input + $6.00 output = ~$8.40/day (Sonnet 4.6 @ $3/M in, $15/M out)
  - Write (3 variants): ~$3.60 + $13.50 = ~$17.10/day
  - Score: ~$1.20 + $3.00 = ~$4.20/day
  - Reply (assume 20% reply rate = 40/day): ~$0.24 + $0.30 = ~$0.54/day
  - Total: ~$30/day uncached, ~$10-15/day with 90% cache hit on system prompts.
- **Forbidden columns.** Scorer and writer do not receive headcount, ARR, industry, vertical, close_date, stage, or deal amounts in their system prompt context. Only operational signals (deploy frequency, incident posts, hiring for platform engineers/SREs, recent engineering blogs, etc.). Enforced in `types.ts` `ResearchBrief` which omits firmographic fields.
- **Hold-out.** 20% of accounts per day skip the writer and route directly to the BDR raw queue. This is the control group for outbound performance comparison. Toggled by `AI_SDR_HOLDOUT_PCT` env var.
- **Identity linking.** Email matching strips sender domains and the customer's own domain before any join with CRM contacts.

## Env vars

| Var | Purpose | Required for |
|---|---|---|
| `ANTHROPIC_API_KEY` | All agents | all |
| `DATABASE_URL` | Neon connection | all |
| `FIRECRAWL_API_KEY` | Signal scraping | researcher |
| `SF_USERNAME`, `SF_PASSWORD`, `SF_SECURITY_TOKEN` | SFDC SOAP login | sender, reply-handler |
| `SLACK_BOT_TOKEN` | Slack posts | all |
| `AI_SDR_APPROVAL_CHANNEL` | Slack channel for approval messages | writer, scorer |
| `AI_SDR_HOLDOUT_PCT` | % of accounts to skip writer (default `20`) | researcher |
| `REACHINBOX_API_KEY`, `REACHINBOX_CAMPAIGN_ID` | ReachInbox sending | sender (ReachInbox adapter) |
| `SMARTLEAD_API_KEY`, `SMARTLEAD_CAMPAIGN_ID` | Cold-email tool | sender (Smartlead adapter) |
| `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` | Gmail API send | sender (Gmail adapter) |
| `GMAIL_FROM_ADDRESS` | The mailbox we send from | sender (Gmail adapter) |
| `AI_SDR_REPLY_WEBHOOK_SECRET` | HMAC verification on inbound reply webhook | reply-handler |

## Slack approval flow

Writer + scorer post one message per account with:
- Account name, pain signal, persona hook (from brief)
- 3 variants (subject + body), each tagged with the value pillar
- Scorer's predicted reply-rate + key risk for each variant
- 4 buttons: `Approve A`, `Approve B`, `Approve C`, `Skip / edit in thread`

Clicking a button triggers the approval webhook handler, which updates `ai_sdr_draft.status` and triggers `ai-sdr-send`.

## Sender routing

`lib/email/router.ts` picks the adapter:

- **ReachInbox** for active campaign delivery.
- **Gmail API** for named-account / enterprise tier.
- **Smartlead** for high-volume cold outreach.

## Layout

- **Docs + DDL**: `pipeline/`
  - `README.md`, `schema.sql`
- **Code**: `pipeline/automations/src/`
  - `ai-sdr-research.ts`, `ai-sdr-write.ts`, `ai-sdr-score.ts`, `ai-sdr-send.ts`, `ai-sdr-reply.ts` (Trigger.dev tasks)
  - `ai-sdr/types.ts` (shared types)
  - `ai-sdr/lib/` (anthropic, neon, prompts, slack, email/{router,reachinbox,smartlead,gmail,types})
- **Skill prompts**: `pipeline/coworker/skills/ai-sdr-{researcher,writer,scorer,reply-classifier}.md`

## Schema

See `schema.sql` for full DDL. Tables:

- `ai_sdr_brief` — researcher output, one row per account per day
- `ai_sdr_draft` — writer output, three rows per brief (variants A/B/C)
- `ai_sdr_score` — scorer output, one row per draft
- `ai_sdr_send` — sender log, one row per actually-sent message
- `ai_sdr_reply` — reply-handler log, one row per inbound reply

Run `psql $DATABASE_URL -f pipeline/schema.sql` to create.

## How to run

```bash
# 1. Create tables in Neon / Postgres
psql $DATABASE_URL -f pipeline/schema.sql

# 2. Configure environment
cp pipeline/automations/.env.example pipeline/automations/.env.local

# 3. Install dependencies and run Trigger.dev dev mode
cd pipeline/automations
npm install
npm run build
npm run dev
```

## Adjacent infrastructure patterns

- `clay-to-neon-sync` — feeds `enrichment_cache` (researcher reads from here)
- `neon-to-crm-push` — pattern for sender + reply handler to write CRM activity
