import type { NetworkMemberView } from "@jigswap/contracts";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { paginateBounded } from "../lib/pageSize";
import schema from "../schema";
import { blockedEitherWaySet } from "./blocks";
import { followExists } from "./readViews";

// A page holds 1 to MAX_PAGE_SIZE members whatever the client asks for.
const MAX_PAGE_SIZE = 50;

// Read side: the CALLER's network for the People page, a page at a time: everyone they follow or who
// follows them, once each, newest edge first. A mutual pair is listed through the caller's own
// follow, so a follower is only read as such when the caller doesn't follow them back. `followsYou`
// comes from the pair itself (one index read per row), so the "Follows you" badge is right however
// many followers there are. Members blocked either way are left out while the page fills (spec 2.6).
//
// SECURITY (SEC-13): a member reads only their own network, so the query takes no member id.
export const listMyNetwork = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const blocked = await blockedEitherWaySet(ctx, viewer);

    const following = stream(ctx.db, schema)
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", viewer))
      .order("desc")
      .filterWith(async (edge) => !blocked.has(edge.followeeId));
    const followers = stream(ctx.db, schema)
      .query("follows")
      .withIndex("by_followee", (q) => q.eq("followeeId", viewer))
      .order("desc")
      .filterWith(
        async (edge) =>
          !blocked.has(edge.followerId) &&
          !(await followExists(ctx, viewer, edge.followerId)),
      );
    const result = await paginateBounded(
      mergedStream([following, followers], ["_creationTime"]),
      args.paginationOpts,
      MAX_PAGE_SIZE,
    );

    const page = await Promise.all(
      result.page.map(async (edge): Promise<NetworkMemberView> => {
        const isOwnFollow = edge.followerId === viewer;
        return {
          memberId: isOwnFollow ? edge.followeeId : edge.followerId,
          followsYou: isOwnFollow
            ? await followExists(ctx, edge.followeeId, viewer)
            : true,
        };
      }),
    );
    return { ...result, page };
  },
});
