// Which admin surfaces show how much work waits (admin.pendingCounts, bounded with a `capped`
// flag), shared by the admin sidebar items and the /admin hub tiles, plus the Unchecked Photos
// tab's count, which comes from its own list. Pure, so it unit-tests without Convex.
import type { gateway } from "@/gateway";
import { sumQueueCounts, type QueueCount } from "@/lib/queue-count";
import type { FunctionReturnType } from "convex/server";

export type PendingCounts = FunctionReturnType<
  typeof gateway.admin.pendingCounts
>;

// The admin nav items (route-meta ADMIN_GROUP keys) that carry a count. Moderation is every
// console queue the server counts; Puzzles is the community change proposals waiting on review.
const NAV_COUNTS = {
  adminModeration: (counts: PendingCounts) =>
    sumQueueCounts([
      counts.submissions,
      counts.flagged,
      counts.appeals,
      counts.reports,
      counts.hashMatches,
    ]),
  adminContact: (counts: PendingCounts) => counts.contact,
  adminPuzzles: (counts: PendingCounts) => counts.proposals,
} satisfies Record<string, (counts: PendingCounts) => QueueCount>;

export const ADMIN_COUNTED_NAV_KEYS: ReadonlySet<string> = new Set(
  Object.keys(NAV_COUNTS),
);

export function adminNavCount(
  key: string,
  counts: PendingCounts,
): QueueCount | undefined {
  return key in NAV_COUNTS
    ? NAV_COUNTS[key as keyof typeof NAV_COUNTS](counts)
    : undefined;
}

// Mirrors UNCHECKED_QUEUE_LIMIT in packages/backend/convex/admin/listUncheckedPhotos.ts: the
// server lists at most this many photos per source and status.
export const UNCHECKED_QUEUE_LIMIT = 50;

// The Unchecked Photos count: every listed photo, capped when any source+status bucket is full
// (more may wait behind it).
export function uncheckedQueueCount(
  photos: readonly { source: string; status: string }[],
): QueueCount {
  const buckets = new Map<string, number>();
  for (const { source, status } of photos) {
    const key = `${source}:${status}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return {
    count: photos.length,
    capped: [...buckets.values()].some((n) => n >= UNCHECKED_QUEUE_LIMIT),
  };
}
