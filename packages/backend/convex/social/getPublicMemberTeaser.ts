import type { PublicMemberTeaserView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { profileVisibilityOf } from "./privacy";

// The UNAUTHENTICATED read behind /members/$handle. Deliberately tiny: identity fields only —
// never bio, shelf, stats, or location. A private member IS disclosed by name on their own direct
// link (spec: Instagram-style interstitial; the page renders robots-noindex for private profiles),
// while enumeration stays blocked because search remains visibility-gated. Handle resolution is
// username-first with a users-id fallback so id-based QR/share links survive username renames.
export const getPublicMemberTeaser = query({
  args: { handle: v.string() },
  handler: async (ctx, args): Promise<PublicMemberTeaserView | null> => {
    const handle = args.handle.trim();
    if (!handle) return null;

    let user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", handle))
      .unique();
    if (!user) {
      const id = ctx.db.normalizeId("users", handle);
      if (id) user = await ctx.db.get(id);
    }
    if (!user || !user.isActive) return null;

    const memberId = user._id;
    const [visibility, profile, viewer] = await Promise.all([
      profileVisibilityOf(ctx, memberId),
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .unique(),
      optionalActingMember(ctx),
    ]);

    // Avatar: any signed-in member may see it (parity with search results and member tiles);
    // anonymous callers only with the member's explicit public-surface consent.
    const avatar =
      viewer !== null || user.shareAvatarPublicly ? user.avatar : undefined;

    // Coarse collection size — public profiles only.
    let puzzleCount: number | null = null;
    if (visibility === "public") {
      const copies = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
        .collect();
      puzzleCount = copies.length;
    }

    return {
      memberId,
      displayName: profile?.displayName ?? user.name,
      username: user.username,
      avatar,
      memberSince: user.createdAt,
      visibility,
      puzzleCount,
    };
  },
});
