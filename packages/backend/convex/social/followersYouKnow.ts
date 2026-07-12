import type { FollowersYouKnowView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { knownFollowerIds } from "./knownFollowers";

// The preview + short modal list are capped to the same small number — a profile row doesn't
// need (or want) to resolve a full intersection, just enough names to feel like social proof.
const PREVIEW_LIMIT = 8;

// Read side: "followers you know" social proof for `memberId`'s profile — accounts the VIEWER
// follows who also follow `memberId` (see social/knownFollowers.ts). Personalized and
// requireMember-gated: the viewer is resolved from auth, never trusted from the client. On your
// own profile there's nothing to show (you don't need social proof about yourself), so
// memberId === viewer short-circuits to empty. The resolved preview members are drawn from the
// viewer's OWN following list, so no additional visibility gating is needed to show their
// identity to this particular viewer.
export const followersYouKnow = query({
  args: { memberId: v.id("users") },
  handler: async (ctx, args): Promise<FollowersYouKnowView> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    if (args.memberId === viewer) return { total: 0, members: [] };

    const ids = await knownFollowerIds(ctx, viewer, args.memberId);
    const preview = ids.slice(0, PREVIEW_LIMIT);

    const resolved = await Promise.all(
      preview.map(async (memberId) => {
        const [user, profile] = await Promise.all([
          ctx.db.get(memberId),
          ctx.db
            .query("profiles")
            .withIndex("by_member", (q) => q.eq("memberId", memberId))
            .unique(),
        ]);
        if (!user) return null;
        return {
          memberId,
          displayName: profile?.displayName ?? user.name,
          avatar: user.avatar,
          username: user.username,
          slug: user.slug,
        };
      }),
    );

    return {
      total: ids.length,
      members: resolved.filter((m): m is NonNullable<typeof m> => m !== null),
    };
  },
});
