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

  // listMyLiveExchanges and listMyExchangeHistory replaced the legacy lists.
  test("the legacy exchange lists are gone", () => {
    expectRemoved([
      "exchange/getUserExchanges",
      "exchange/getExchangesByOwner",
      "exchange/getExchangesByRequester",
    ]);
  });

  // A dispute had no way back out, so a party could freeze a finished trade and stop the partner's
  // review; the one-copy share told a missing copy from someone else's. shareCopiesToCircle is the
  // only way to share now.
  test("raiseDispute and the one-copy share are gone", () => {
    expectRemoved(["exchange/raiseDispute", "sharing/shareCopyToCircle"]);
  });

  test("the write-only personal categories feature is gone", () => {
    expectRemoved([
      "library/createPersonalCategory",
      "library/adapters/convexPersonalCategoryRepository",
    ]);
  });
});
