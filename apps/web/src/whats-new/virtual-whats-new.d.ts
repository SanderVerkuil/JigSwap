declare module "virtual:whats-new" {
  import type { WhatsNewEntry } from "@/whats-new/types";
  /** Newest first (publishedAt desc, then id). */
  export const entries: WhatsNewEntry[];
}
