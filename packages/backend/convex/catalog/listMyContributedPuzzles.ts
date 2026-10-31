import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";

// Read side for the add-copy picker: the current member's OWN not-yet-approved submissions.
// Public catalog lists only surface approved definitions, but a member may acquire a copy of a
// puzzle they submitted even before it is approved, so the picker needs these to offer them.
// Auth-gated to the acting member; reads resolve the box art like the other catalog queries: its
// URL behind the publication gate (boxArtImage), plus the renditions' `imageSrcSet` once they exist
// (the add page shows these as grid cards).
export const listMyContributedPuzzles = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);

    const mine = await ctx.db
      .query("puzzles")
      .withIndex("by_submitted_by", (q) =>
        // The domain MemberId is the user's Convex _id.
        q.eq("submittedBy", memberId as unknown as Id<"users">),
      )
      .order("desc")
      .collect();

    // Approved submissions already appear in the public search; only surface the pending/rejected
    // ones the picker would otherwise be missing.
    const notYetApproved = mine.filter((p) => p.status !== "approved");

    return Promise.all(
      notYetApproved.map(async (puzzle) => {
        const image = puzzle.image
          ? await boxArtImage(ctx, puzzle.image)
          : undefined;
        return {
          ...puzzle,
          image: image === undefined ? undefined : (image?.url ?? null),
          // Absent (not undefined) without renditions, so the response is what it was before them.
          ...(image?.srcSet !== undefined && { imageSrcSet: image.srcSet }),
        };
      }),
    );
  },
});
