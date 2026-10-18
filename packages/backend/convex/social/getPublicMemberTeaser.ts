import type { PublicMemberTeaserView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { resolveMemberByHandle } from "../identity/resolveMemberByHandle";
import { isCopyPrivate, seesPrivateCopiesOf } from "../library/copyVisibility";
import { blockStateBetween } from "./blocks";
import {
  memberTeaserIdentityOf,
  profileVisibilityOf,
  shareACircle,
} from "./privacy";

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

    // Blocked (spec 2.6): the blocked side reads not-found; the blocker gets the identity only.
    // Except inside a shared circle: the circle names its members to each other even across a
    // block (§5.3), so a not-found here would give the block away. The blocked side then gets the
    // identity-only teaser (no count), as the web shows for a profile it can't open.
    const block =
      viewer === null || viewer === memberId
        ? undefined
        : await blockStateBetween(ctx, viewer, memberId);
    if (block === "byThem") {
      if (viewer === null || !(await shareACircle(ctx, viewer, memberId))) {
        return null;
      }
      return {
        ...memberTeaserIdentityOf(user, profile, true),
        memberSince: user.createdAt,
        visibility,
        puzzleCount: null,
      };
    }
    if (block === "byMe") {
      return {
        ...memberTeaserIdentityOf(user, profile, true),
        memberSince: user.createdAt,
        visibility,
        puzzleCount: null,
        blockedByMe: true,
      };
    }

    // Avatar (memberTeaserIdentityOf): any signed-in member may see it — the spec's interstitial
    // shows the person's full identity so the page feels human ("person feels present");
    // anonymous callers only see it with the member's explicit public-surface consent.

    // Coarse collection size — public profiles only. Capped so a giant collection can't blow the
    // Convex read limit and 500 the page (coarse count, capped — spec asks for ~N).
    let puzzleCount: number | null = null;
    if (visibility === "public") {
      const copies = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
        .take(1001);
      // Private copies count only for the member themself and their household.
      puzzleCount = (await seesPrivateCopiesOf(ctx, viewer, memberId))
        ? copies.length
        : copies.filter((copy) => !isCopyPrivate(copy)).length;
    }

    return {
      ...memberTeaserIdentityOf(user, profile, viewer !== null),
      memberSince: user.createdAt,
      visibility,
      puzzleCount,
    };
  },
});
