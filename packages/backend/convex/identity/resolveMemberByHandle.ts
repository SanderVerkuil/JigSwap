import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// THE single source of handle resolution for every public, unauthenticated member surface
// (/members/$handle teaser, the public profile). Resolution is ID-FIRST, then slug, then
// username: if the handle resolves to an existing users id we use that member and NEVER
// consult by_slug/by_username for it. This is a SECURITY invariant, not a style choice — it
// MUST run first and must never be shadowed by a later branch. It makes id-based URLs (which
// Phase 3 QR codes encode) immune to slug/username shadowing: both slug and username are
// user-chosen and can be shaped like a Convex id, so an id-last order would let one member
// hijack another member's id URL. Only when the handle is not an existing user id do we fall
// back to the Convex-owned by_slug lookup, then the Clerk-owned by_username lookup.
export const resolveMemberByHandle = async (
  ctx: QueryCtx,
  handle: string,
): Promise<Doc<"users"> | null> => {
  const trimmed = handle.trim();
  if (!trimmed) return null;

  let user: Doc<"users"> | null = null;
  const id = ctx.db.normalizeId("users", trimmed);
  if (id) user = await ctx.db.get(id);
  if (!user) {
    user = await ctx.db
      .query("users")
      .withIndex("by_slug", (q) => q.eq("slug", trimmed))
      .unique();
  }
  if (!user) {
    user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", trimmed))
      .unique();
  }
  if (!user || !user.isActive) return null;
  return user;
};
