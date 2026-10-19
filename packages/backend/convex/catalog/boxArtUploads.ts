import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Box art (a puzzle definition's `image`, or a proposed one) is served to everyone, so it gets
// exactly the checks every uploaded photo gets: the shared image-moderation pipeline
// (lib/imageModeration/pipeline: input guards, metadata strip + turned upright, CSAM hash check,
// content classification). The client uploads the file, then calls catalog/sanitizeBoxArt, which
// lists the upload in `boxArtUploads` for that member and runs the pipeline on it at once
// (catalog/moderateBoxArt; catalog/importPuzzleImage does the same for a fetched shop image). The
// catalog mutations only take a NEW image listed there for the acting member
// (assertBoxArtImage), and no read path serves it until it is approved with its hash check
// passed (lib/imageModeration/boxArtUrl).

/** An upload must be claimed within this long of its creation. */
export const BOX_ART_CLAIM_WINDOW_MS = 15 * 60_000;

/** Why box art was refused (the ConvexError code is "InvalidImage"). */
export type BoxArtRefusal =
  | "too_large"
  | "unsupported_format"
  | "unreadable_header"
  | "too_many_pixels"
  | "malformed"
  // Refused by the content check, or a CSAM hash match: deliberately the same answer, so the
  // uploader is never told that known abuse material was recognised (lib/imageModeration/
  // quarantine).
  | "not_allowed";

export const boxArtRefused = (reason: BoxArtRefusal) =>
  new ConvexError({
    code: "InvalidImage",
    message: "This image can't be used",
    reason,
  });

/** The acting member (an action has no ctx.db). */
export const currentMember = internalQuery({
  args: {},
  handler: async (ctx) => (await requireMember(ctx)) as unknown as Id<"users">,
});

/**
 * A catalog mutation's `image` arg must be unchanged (one of `current`: the definition's image,
 * or the proposal's) or box art listed for the acting member and not refused (pending or
 * unscored box art is accepted: boxArtUrl keeps it unserved until it is approved). Anything else, such as a raw
 * upload straight from generateUploadUrl, is refused.
 */
export const assertBoxArtImage = async (
  ctx: QueryCtx,
  image: string | undefined,
  member: Id<"users">,
  current: ReadonlyArray<string | undefined> = [],
): Promise<void> => {
  if (image === undefined || current.includes(image)) return;
  const storageId = ctx.db.system.normalizeId("_storage", image);
  const row =
    storageId &&
    (await ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first());
  if (
    !row ||
    row.uploaderId !== member ||
    row.moderationStatus === "rejected" ||
    row.moderationStatus === "quarantined"
  ) {
    throw new ConvexError({
      code: "InvalidImage",
      message: "This image can't be used",
    });
  }
};
