import { describe, expect, it } from "vitest";
import {
  ADMIN_COUNTED_NAV_KEYS,
  adminNavCount,
  UNCHECKED_QUEUE_LIMIT,
  uncheckedQueueCount,
  type PendingCounts,
} from "./pending-counts";

const exact = (count: number) => ({ count, capped: false });

const counts: PendingCounts = {
  submissions: exact(2),
  flagged: exact(1),
  appeals: exact(3),
  reports: { count: 50, capped: true },
  hashMatches: exact(1),
  contact: exact(4),
  proposals: exact(5),
};

describe("adminNavCount", () => {
  it("Moderation sums its queues and is capped when one of them is", () => {
    expect(adminNavCount("adminModeration", counts)).toEqual({
      count: 57,
      capped: true,
    });
  });

  it("Contact and Puzzles carry their own queue", () => {
    expect(adminNavCount("adminContact", counts)).toEqual(exact(4));
    expect(adminNavCount("adminPuzzles", counts)).toEqual(exact(5));
  });

  it("other items carry no count", () => {
    expect(adminNavCount("adminUsers", counts)).toBeUndefined();
    expect(adminNavCount("messages", counts)).toBeUndefined();
  });

  it("names exactly the items that carry a count", () => {
    expect([...ADMIN_COUNTED_NAV_KEYS].sort()).toEqual([
      "adminContact",
      "adminModeration",
      "adminPuzzles",
    ]);
  });
});

describe("uncheckedQueueCount", () => {
  const photos = (
    source: "copy" | "message",
    status: "pending" | "unscored",
    n: number,
  ) => Array.from({ length: n }, () => ({ source, status }));

  it("counts every listed photo", () => {
    expect(
      uncheckedQueueCount([
        ...photos("copy", "pending", 3),
        ...photos("message", "unscored", 2),
      ]),
    ).toEqual(exact(5));
  });

  it("is capped once any source and status reached the server's per-bucket limit", () => {
    expect(
      uncheckedQueueCount([
        ...photos("copy", "unscored", UNCHECKED_QUEUE_LIMIT),
        ...photos("message", "unscored", 2),
      ]),
    ).toEqual({ count: UNCHECKED_QUEUE_LIMIT + 2, capped: true });
  });

  it("is not capped when the limit is only reached across buckets", () => {
    expect(
      uncheckedQueueCount([
        ...photos("copy", "unscored", UNCHECKED_QUEUE_LIMIT - 1),
        ...photos("copy", "pending", UNCHECKED_QUEUE_LIMIT - 1),
      ]),
    ).toEqual(exact(2 * (UNCHECKED_QUEUE_LIMIT - 1)));
  });
});
