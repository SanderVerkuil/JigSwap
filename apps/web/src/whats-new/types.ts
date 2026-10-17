import type { WhatsNewCategory } from "@jigswap/contracts";

// Mirrors `locales` in src/lib/i18n.ts (not imported: that module pulls in TanStack Start server
// code, and this one also runs inside the Vite config). `en` is canonical; `nl` falls back to it.
export const WHATS_NEW_LOCALES = ["en", "nl"] as const;
export type WhatsNewLocale = (typeof WHATS_NEW_LOCALES)[number];

export interface WhatsNewLocalizedContent {
  title: string;
  summary: string;
  /** Rendered Markdown body: headings demoted two levels, code highlighted by Shiki. */
  html: string;
  imageAlt?: string;
  ctaLabel?: string;
  /** True when this locale has no file of its own and shows the `en` content. */
  fallback: boolean;
}

/** One entry as exposed by `virtual:whats-new`. */
export interface WhatsNewEntry {
  id: string;
  /** Epoch ms (UTC). */
  publishedAt: number;
  category: WhatsNewCategory;
  highlight: boolean;
  notify: boolean;
  tour?: string;
  image?: string;
  /** In-app path for the call to action; its label is per locale. */
  ctaTo?: string;
  content: Record<WhatsNewLocale, WhatsNewLocalizedContent>;
}
