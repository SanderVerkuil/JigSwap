import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireMember } from "./identity/requireMember";
import { logEvent } from "./lib/logEvent";
import { enforceRateLimit } from "./lib/rateLimits";

// Storage infrastructure, not a domain read/write. Kept here (out of scope of the read-model
// cutover) so the upload flow that backs copy/box-art photos is unchanged.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Gate behind authentication: an ungated public mutation lets anyone with the deployment URL
    // mint presigned upload URLs and write arbitrary blobs (cost/quota abuse), like every other
    // write and the sibling catalog/importPuzzleImage guard.
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    // SEC-20: rate limited per member like the message-photo and circle-icon URLs, and every mint
    // is logged with the member, so unclaimed uploads can be attributed (_storage records no
    // uploader).
    await enforceRateLimit(ctx, "uploadUrl", me);
    await enforceRateLimit(ctx, "uploadUrlDaily", me);
    logEvent({
      event: "storage.uploadUrl",
      outcome: "success",
      member_id: me,
    });
    const url = await ctx.storage.generateUploadUrl();
    return url;
  },
});
