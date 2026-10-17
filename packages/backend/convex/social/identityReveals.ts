import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Read + write sides of the `identityReveals` grants (see the schema comment). A grant lets
// `viewerId` see `targetId`'s real identity and full profile — the trade counterpart of being
// mutual followers. Grants are append-only and global per directed pair.

/** True iff `viewerId` holds an identity grant toward `targetId` (one indexed point read). */
export const hasIdentityReveal = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
): Promise<boolean> => {
  if (viewerId === targetId) return false;
  const grant = await ctx.db
    .query("identityReveals")
    .withIndex("by_viewer_target", (q) =>
      q.eq("viewerId", viewerId).eq("targetId", targetId),
    )
    .first();
  return grant !== null;
};

/**
 * Idempotently record a grant: inserts only when the pair holds none yet (the first grant's
 * origin is kept). Returns whether a row was written.
 */
export const grantIdentityReveal = async (
  ctx: MutationCtx,
  grant: {
    viewerId: Id<"users">;
    targetId: Id<"users">;
    exchangeId: Id<"exchanges">;
    reason: Doc<"identityReveals">["reason"];
    createdAt: number;
  },
): Promise<boolean> => {
  if (grant.viewerId === grant.targetId) return false;
  if (await hasIdentityReveal(ctx, grant.viewerId, grant.targetId)) {
    return false;
  }
  await ctx.db.insert("identityReveals", grant);
  return true;
};
