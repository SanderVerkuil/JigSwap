import type { WhatsNewEntry } from "@/whats-new/types";
import { entries } from "virtual:whats-new";

// The one place the UI reads `virtual:whats-new` (bundled at build time, newest first). Tests mock
// this module, since vitest does not run the Vite plugin.
export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = entries;

export const WHATS_NEW_IDS: ReadonlySet<string> = new Set(
  entries.map((entry) => entry.id),
);
