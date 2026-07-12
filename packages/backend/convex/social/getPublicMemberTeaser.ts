import type { PublicMemberTeaserView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { resolveMemberByHandle } from "../identity/resolveMemberByHandle";
import { profileVisibilityOf } from "./privacy";

// The UNAUTHENTICATED read behind /members/$handle. Deliberately tiny: identity fields only —
// never bio, shelf, stats, or location. A private member IS disclosed by name on their own direct
// link (spec: Instagram-style interstitial; the page renders robots-noindex for private profiles),
// while enumeration stays blocked because search remains visibility-gated.
//
// Handle resolution (id-first, then slug, then username — see identity/resolveMemberByHandle,
// the single source of this SECURITY-critical precedence) is shared with getPublicProfile.
export const getPublicMemberTeaser = query({
  args: { handle: v.string() },
  handler: async (ctx, args): Promise<PublicMemberTeaserView | null> => {
    const user = await resolveMemberByHandle(ctx, args.handle);
    if (!user) return null;

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
      slug: user.slug,
      avatar,
      memberSince: user.createdAt,
      visibility,
      puzzleCount,
    };
  },
});
