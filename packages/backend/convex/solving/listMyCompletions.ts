import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side for the solving history view: the acting member's own completions, newest first.
// Auth-gated; photo storage ids are resolved to URLs like the other queries that surface images.
export const listMyCompletions = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);

    const rows = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) =>
        q.eq("userId", memberId as unknown as Id<"users">),
      )
      .order("desc")
      .collect();

    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        photoUrls: await resolvePhotoUrls(ctx, row.photos),
      })),
    );
  },
});

// Resolve each stored `_storage` id to a served URL (null entries are dropped by the UI).
const resolvePhotoUrls = (
  ctx: { storage: { getUrl(id: Id<"_storage">): Promise<string | null> } },
  photos: readonly Id<"_storage">[],
): Promise<(string | null)[]> =>
  Promise.all(photos.map((fileId) => ctx.storage.getUrl(fileId)));
