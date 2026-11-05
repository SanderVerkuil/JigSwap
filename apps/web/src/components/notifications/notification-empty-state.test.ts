import { describe, expect, it } from "vitest";
import { emptyStateFor } from "./notification-empty-state";

const base = {
  loaded: 30,
  shown: 0,
  unreadOnly: false,
  unreadTotal: 0,
  canLoadMore: false,
};

describe("emptyStateFor", () => {
  it("is nothing while rows are shown", () => {
    expect(emptyStateFor({ ...base, shown: 4 })).toBeNull();
  });

  it("says 'no notifications yet' only when there are none at all", () => {
    expect(emptyStateFor({ ...base, loaded: 0 })).toEqual({ kind: "none" });
  });

  it("says 'all caught up' when the unread filter is on and nothing is unread anywhere", () => {
    expect(emptyStateFor({ ...base, unreadOnly: true })).toEqual({
      kind: "caughtUp",
    });
    // Even with a category picked: there is no unread row in any category.
    expect(
      emptyStateFor({ ...base, unreadOnly: true, canLoadMore: true }),
    ).toEqual({ kind: "caughtUp" });
  });

  it("never claims 'no notifications' or 'caught up' while unread rows exist elsewhere", () => {
    // The review's case: a category filter matches nothing, the badge counts unread rows.
    expect(emptyStateFor({ ...base, unreadTotal: 3 })).toEqual({
      kind: "noMatch",
      moreToLoad: false,
    });
    expect(
      emptyStateFor({ ...base, unreadOnly: true, unreadTotal: 3 }),
    ).toEqual({ kind: "noMatch", moreToLoad: false });
  });

  it("says only the loaded pages were filtered when more pages exist", () => {
    expect(emptyStateFor({ ...base, canLoadMore: true })).toEqual({
      kind: "noMatch",
      moreToLoad: true,
    });
  });
});
