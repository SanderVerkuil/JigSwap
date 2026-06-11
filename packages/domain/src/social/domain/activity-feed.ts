// The activity feed read model: a pure projection that folds activity events into a feed sorted
// newest-first. The source events (CompletionRecorded, CopyAcquired, ExchangeCompleted) are
// owned by OTHER contexts, so Social keeps its OWN local anti-corruption shape (ActivityEntry)
// and never depends on those foreign event types. Pure and total — no ports, no I/O.

import { MemberId } from "./ids";

// The kinds of activity Social surfaces in a feed, translated from foreign events at the seam.
export type ActivityKind = "completion" | "acquisition" | "exchange";

// Social's local, anti-corruption view of one piece of activity. `ref` is an opaque pointer back
// to the originating record (e.g. a completion or exchange id) for the UI to deep-link; Social
// does not interpret it.
export interface ActivityEntry {
  readonly memberId: MemberId;
  readonly kind: ActivityKind;
  readonly occurredAt: Date;
  readonly ref: string;
}

export interface BuildActivityFeedOptions {
  // Cap the feed length, keeping the newest entries. Omit for the full feed.
  readonly limit?: number;
}

// Sort entries newest-first and optionally cap the length. Stable for equal timestamps (input
// order is preserved among ties) and total — empty input yields an empty feed.
export const buildActivityFeed = (
  entries: readonly ActivityEntry[],
  options: BuildActivityFeedOptions = {},
): readonly ActivityEntry[] => {
  const sorted = [...entries].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
  return options.limit === undefined ? sorted : sorted.slice(0, options.limit);
};
