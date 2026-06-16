import { mutation } from "./_generated/server";
import { requireMember } from "./identity/requireMember";

// Storage infrastructure, not a domain read/write. Kept here (out of scope of the read-model
// cutover) so the upload flow that backs copy/box-art photos is unchanged.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Gate behind authentication: an ungated public mutation lets anyone with the deployment URL
    // mint presigned upload URLs and write arbitrary blobs (cost/quota abuse), like every other
    // write and the sibling catalog/importPuzzleImage guard.
    await requireMember(ctx);
    const url = await ctx.storage.generateUploadUrl();
    return url;
  },
});
