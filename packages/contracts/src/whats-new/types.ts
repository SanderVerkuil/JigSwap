// What's new: the entry metadata manifest shared by backend and web, plus the read-state views
// (queries under `whatsNew/*`). Entry content lives in docs/whats-new/*.md and reaches the web via
// `virtual:whats-new`; the backend only needs this metadata (ids, dates, flags).

export type WhatsNewCategory = "feature" | "improvement" | "fix";

/** Locale-invariant entry metadata, generated from the Markdown frontmatter. */
export interface WhatsNewManifestEntry {
  id: string;
  /** Epoch ms (UTC). */
  publishedAt: number;
  /** Eligible for the one-time highlight modal. */
  highlight: boolean;
  /** Sends a `whats_new` notification. */
  notify: boolean;
  /** Tour started from this entry, if any. */
  tour?: string;
}

export type WhatsNewTourStatus = "in_progress" | "completed" | "dismissed";

export interface WhatsNewTourProgressView {
  tourId: string;
  status: WhatsNewTourStatus;
  /** 0-based index of the current (in_progress) or last step. */
  step?: number;
  updatedAt: number;
}

export interface WhatsNewStateView {
  /** Unread entry ids, newest first. Entries published before the account existed never appear. */
  unreadIds: string[];
  tours: WhatsNewTourProgressView[];
}
