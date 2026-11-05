import { describe, expect, it } from "vitest";
import { toCopyId, toMemberId } from "../../../shared-kernel";
import { CopyId, MemberId } from "../../domain";
import {
  CopyReviewRepository,
  CopyReviewUpsert,
} from "../ports/out/review.repositories";
import { makeDeleteCopyReview } from "./delete-copy-review";

const ALICE = toMemberId("alice");
const BOB = toMemberId("bob");
const COPY = toCopyId("copy-1");
const OTHER_COPY = toCopyId("copy-2");
const NOW = new Date("2026-10-31T10:00:00Z");

// One row per (member, copy), as the persistence adapter keeps it.
class InMemoryCopyReviews implements CopyReviewRepository {
  readonly rows = new Map<string, CopyReviewUpsert>();
  private key = (userId: MemberId, copyId: CopyId) => `${userId}/${copyId}`;
  async upsert(review: CopyReviewUpsert): Promise<void> {
    this.rows.set(this.key(review.userId, review.copyId), review);
  }
  async remove(userId: MemberId, copyId: CopyId): Promise<boolean> {
    return this.rows.delete(this.key(userId, copyId));
  }
}

const seeded = async () => {
  const copyReviews = new InMemoryCopyReviews();
  await copyReviews.upsert({
    userId: ALICE,
    copyId: COPY,
    rating: 4,
    now: NOW,
  });
  await copyReviews.upsert({ userId: BOB, copyId: COPY, rating: 2, now: NOW });
  await copyReviews.upsert({
    userId: ALICE,
    copyId: OTHER_COPY,
    rating: 5,
    now: NOW,
  });
  return copyReviews;
};

describe("makeDeleteCopyReview", () => {
  it("removes only the acting member's review of that copy", async () => {
    const copyReviews = await seeded();
    const deleteReview = makeDeleteCopyReview({ copyReviews });

    const result = await deleteReview({ actingMemberId: ALICE, copyId: COPY });

    expect(result.isOk).toBe(true);
    expect([...copyReviews.rows.keys()].sort()).toEqual([
      "alice/copy-2",
      "bob/copy-1",
    ]);
  });

  it("answers CopyReviewNotFound when the member has no review of the copy", async () => {
    const copyReviews = await seeded();
    const deleteReview = makeDeleteCopyReview({ copyReviews });

    const result = await deleteReview({
      actingMemberId: BOB,
      copyId: OTHER_COPY,
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CopyReviewNotFound");
    expect(copyReviews.rows.size).toBe(3);
  });
});
