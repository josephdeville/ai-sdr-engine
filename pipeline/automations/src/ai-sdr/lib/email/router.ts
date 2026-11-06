import { reachinboxAdapter } from "./reachinbox.js";
import type { EmailAdapter } from "./types.js";

/**
 * Picks the sender for an account.
 *
 * ReachInbox is the live sending tool for all tiers. The Smartlead and Gmail
 * adapters remain in the tree as stubs but are not currently routed to. The
 * `tier` argument is retained for future per-tier routing.
 */
export function pickAdapter(_tier: "named" | "mid-market" | "smb" | undefined): EmailAdapter {
  return reachinboxAdapter;
}
