// A bounded "items waiting" count, as the admin queues report it: the server stops counting at a
// cap and says so (`capped`), and the UI then shows "50+" rather than a number that looks exact.

export type QueueCount = { count: number; capped: boolean };

export function formatQueueCount(count: number, capped = false): string {
  return capped ? `${count}+` : String(count);
}

// Several queues as one count (e.g. the Moderation nav item): capped as soon as any part is.
export function sumQueueCounts(counts: readonly QueueCount[]): QueueCount {
  return counts.reduce<QueueCount>(
    (sum, part) => ({
      count: sum.count + part.count,
      capped: sum.capped || part.capped,
    }),
    { count: 0, capped: false },
  );
}
