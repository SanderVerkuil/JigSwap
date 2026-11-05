import type { WhatsNewEntry } from "@/whats-new/types";
import { entries } from "virtual:whats-new";

// The one place the UI reads `virtual:whats-new` (bundled at build time, newest first). Tests mock
// this module, since vitest does not run the Vite plugin. It holds every entry's rendered body, so
// only /whats-new imports it statically; shell-wide code reads the @jigswap/contracts manifest and
// the highlight modal imports this on demand.
export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = entries;
