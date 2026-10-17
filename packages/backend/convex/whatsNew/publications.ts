import type { QueryCtx } from "../_generated/server";

export const publicationOf = (ctx: QueryCtx, entryId: string) =>
  ctx.db
    .query("whatsNewPublications")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .unique();
