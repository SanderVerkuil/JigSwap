import { describe, expect, test } from "vitest";

// Public Convex functions are directly callable, so each unused one is attack surface. These
// modules were deleted because no screen calls them; the copy page reads getCopyInstanceView.
const modules = Object.keys(import.meta.glob("./**/*.ts"));

const expectRemoved = (removed: string[]) => {
  for (const path of removed) {
    expect(modules, path).not.toContain(`./${path}.ts`);
  }
};

describe("removed public reads", () => {
  test("the old copy-detail reads are gone", () => {
    expectRemoved([
      "library/getOwnedPuzzleWithCollectionStatus",
      "library/getCopyLoanHistory",
      "custody/getCopyCustodyTimeline",
    ]);
  });

  test("the unused marketing queries are gone", () => {
    expectRemoved([
      "insights/getPlankPuzzles",
      "insights/getCommunityAvatars",
      "insights/sampling",
    ]);
  });

  test("the reads and the write nothing calls are gone", () => {
    expectRemoved([
      "catalog/listAllPuzzles",
      "exchange/getExchangeById",
      "social/isFollowing",
      "whatsNew/markAllSeen",
    ]);
  });
});
