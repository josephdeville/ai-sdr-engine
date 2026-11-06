import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// from automations/src/ai-sdr/lib/ → ../../../../coworker/skills
const SKILLS_DIR = resolve(here, "../../../../coworker/skills");

const cache = new Map<string, string>();

function load(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const path = resolve(SKILLS_DIR, `${name}.md`);
  const text = readFileSync(path, "utf8");
  cache.set(name, text);
  return text;
}

export const SystemPrompts = {
  researcher: () => load("ai-sdr-researcher"),
  writer: () => load("ai-sdr-writer"),
  scorer: () => load("ai-sdr-scorer"),
  replyClassifier: () => load("ai-sdr-reply-classifier"),
} as const;
