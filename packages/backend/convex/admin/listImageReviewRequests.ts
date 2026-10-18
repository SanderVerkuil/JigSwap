import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import type { ImageAttachment } from "../conversation/messageAttachments";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";

// Message photos the automated check rejected AND whose sender asked for a review (spec R.10):
// the only way an admin ever sees a private message photo that was not reported. Oldest request
// first. Quarantined photos never appear (nobody may view them), even when a review was asked;
// neither does anything about the conversation or the recipient. Admin-only.
export const listImageReviewRequests = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const rows = await ctx.db
      .query("messageAttachments")
      .withIndex("by_review_requested", (q) => q.gt("reviewRequestedAt", 0))
      .collect();
    return Promise.all(
      rows
        .filter(
          (row): row is ImageAttachment =>
            row.kind === "image" &&
            row.moderationStatus === "rejected" &&
            row.reviewDecidedAt === undefined,
        )
        .map(async (row) => {
          const uploader = await ctx.db.get(row.uploaderId);
          return {
            attachmentId: row._id,
            // No URL before the CSAM hash check has passed; none when the blob is gone (an
            // unreadable upload is deleted by the pipeline).
            url:
              row.hashCheckedAt !== undefined
                ? await ctx.storage.getUrl(row.fileId)
                : null,
            score: row.moderationScore ?? null,
            label: row.moderationLabel ?? null,
            reason: row.moderationReason ?? null,
            uploaderName: uploader ? adminMemberLabelOf(uploader) : null,
            uploadedAt: row.createdAt,
            reviewRequestedAt: row.reviewRequestedAt!,
          };
        }),
    );
  },
});
