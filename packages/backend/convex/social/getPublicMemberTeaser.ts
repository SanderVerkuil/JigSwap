import type { PublicMemberTeaserView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { profileVisibilityOf } from "./privacy";

// The UNAUTHENTICATED read behind /members/$handle. Deliberately tiny: identity fields only —
// never bio, shelf, stats, or location. A private member IS disclosed by name on their own direct
// link (spec: Instagram-style interstitial; the page renders robots-noindex for private profiles),
// while enumeration stays blocked because search remains visibility-gated.
//
// Handle resolution is ID-FIRST: if the handle resolves to an existing users id we use that member
// and NEVER consult by_username for it. This makes id-based URLs (which Phase 3 QR codes encode)
// immune to username shadowing — Clerk usernames are user-controlled and can be shaped like a
// Convex id, so a username-first order would let one member's username hijack another member's
// id URL. Only when the handle is not an existing user id do we fall back to the by_username lookup.
export const getPublicMemberTeaser = query({
  args: { handle: v.string() },
  handler: async (ctx, args): Promise<PublicMemberTeaserView | null> => {
    const handle = args.handle.trim();
    if (!handle) return null;

    let user = null;
    const id = ctx.db.normalizeId("users", handle);
    if (id) user = await ctx.db.get(id);
    if (!user) {
      user = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", handle))
        .unique();
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

    // Avatar: any signed-in member may see it — the spec's interstitial shows the person's full
    // identity so the page feels human ("person feels present"); anonymous callers only see it
    // with the member's explicit public-surface consent.
    const avatar =
      viewer !== null || user.shareAvatarPublicly ? user.avatar : undefined;

    // Coarse collection size — public profiles only. Capped so a giant collection can't blow the
    // Convex read limit and 500 the page (coarse count, capped — spec asks for ~N).
    let puzzleCount: number | null = null;
    if (visibility === "public") {
      const copies = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
        .take(1001);
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
