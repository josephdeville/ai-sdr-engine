import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODELS = {
  research: "claude-sonnet-4-6",
  write: "claude-sonnet-4-6",
  score: "claude-sonnet-4-6",
  reply: "claude-sonnet-4-6",
  variantPick: "claude-haiku-4-5-20251001",
} as const;

const PRICING_USD_PER_M = {
  "claude-sonnet-4-6": { input: 3, output: 15, cachedInput: 0.3 },
  "claude-opus-4-7": { input: 15, output: 75, cachedInput: 1.5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cachedInput: 0.1 },
} as const;

export interface CallArgs {
  model: keyof typeof PRICING_USD_PER_M;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface CallResult {
  text: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Calls Claude with the system prompt marked as cacheable (ephemeral cache,
 * 5-min TTL). On repeated calls within 5 min the system prompt reads from
 * cache at 10x discount.
 *
 * Cost is reported in USD (dollars). Framework §1.5: never trust LLM
 * self-reported cost math; this fn computes locally from published rates.
 */
export async function callClaude(args: CallArgs): Promise<CallResult> {
  const res = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 2048,
    system: [
      {
        type: "text",
        text: args.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: args.userMessage }],
  });

  const inputTokens = res.usage.input_tokens ?? 0;
  const cachedInputTokens = res.usage.cache_read_input_tokens ?? 0;
  const outputTokens = res.usage.output_tokens ?? 0;

  const rates = PRICING_USD_PER_M[args.model];
  const uncachedInput = inputTokens - cachedInputTokens;
  const costUsd =
    (uncachedInput * rates.input) / 1_000_000 +
    (cachedInputTokens * rates.cachedInput) / 1_000_000 +
    (outputTokens * rates.output) / 1_000_000;

  const block = res.content[0];
  const text = block?.type === "text" ? block.text : "";

  return { text, inputTokens, cachedInputTokens, outputTokens, costUsd };
}
