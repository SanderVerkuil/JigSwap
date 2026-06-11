import { mutation } from "./_generated/server";

// Storage infrastructure, not a domain read/write. Kept here (out of scope of the read-model
// cutover) so the upload flow that backs copy/box-art photos is unchanged.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const url = await ctx.storage.generateUploadUrl();
    return url;
  },
});
