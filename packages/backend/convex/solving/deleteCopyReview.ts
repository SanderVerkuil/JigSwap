import { makeDeleteCopyReview, toCopyId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyReviewRepository } from "./adapters/convexReviewRepositories";
import { toConvexError } from "./errors";

// Composition root for "Delete my review" on the copy page (SEC-70): delete the caller's single
// `copyReviews` star row for the copy. The member comes from auth, never the client, and the
// (member, copy) pair is the review's key, so a member can only ever delete their own — the copy
// owner included, who cannot remove other members' ratings of their copy. CopyReviewNotFound
// when they have none. The copy page's average is computed from the remaining rows on read.
export const deleteCopyReview = mutation({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    const deleteCopyReviewUseCase = makeDeleteCopyReview({
      copyReviews: convexCopyReviewRepository(ctx),
    });
    const result = await deleteCopyReviewUseCase({
      actingMemberId: memberId,
      copyId: toCopyId(args.copyId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
