import type { MyLibraryWindowView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { clampLimit } from "../lib/pageSize";
import { readMemberLibraryCounts } from "./memberLibraryCounts";
import {
  LIBRARY_WINDOW_MAX,
  libraryScopeOf,
  newestCopiesOf,
  toMyLibraryCopyViews,
} from "./myLibraryRows";

const DEFAULT_WINDOW = 48;

// Library read: the first `limit` copies of the viewer's library, newest first, for My Puzzles and
// the household's Puzzles tab when nothing narrows them but whose copies they are. Only these rows
// are read and joined, so an edit of a copy further down doesn't re-run it, and `matched` and `total`
// come from the owners' counters (library/memberLibraryCounts). The web asks for a longer window as
// the member scrolls; one subscription, never more rows than they have asked to see.
//
// Scope is server-computed: the viewer's own copies plus their housemates' (the household rule of
// canViewCopy). `owner` narrows that ("mine", "household"); `memberId` narrows it to one member of
// the household, and names nobody else's library: any other id is an empty result.
export const listMyLibraryWindow = query({
  args: {
    limit: v.number(),
    owner: v.optional(
      v.union(v.literal("all"), v.literal("mine"), v.literal("household")),
    ),
    memberId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<MyLibraryWindowView> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const scope = await libraryScopeOf(ctx, viewerId);
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_WINDOW,
      max: LIBRARY_WINDOW_MAX,
    });

    const mates = [...scope.mates];
    const everyone = [viewerId, ...mates];
    const owners =
      args.memberId !== undefined
        ? everyone.filter((id) => id === args.memberId)
        : args.owner === "mine"
          ? [viewerId]
          : args.owner === "household"
            ? mates
            : everyone;

    const counts = new Map(
      await Promise.all(
        everyone.map(
          async (id) =>
            [id, (await readMemberLibraryCounts(ctx, id)).owned] as const,
        ),
      ),
    );
    const sum = (ids: readonly Id<"users">[]) =>
      ids.reduce((total, id) => total + (counts.get(id) ?? 0), 0);

    if (owners.length === 0) {
      return { rows: [], hasMore: false, matched: 0, total: sum(everyone) };
    }
    const copies = await newestCopiesOf(ctx, owners, limit + 1);
    return {
      rows: await toMyLibraryCopyViews(ctx, copies.slice(0, limit), scope),
      hasMore: copies.length > limit,
      matched: sum(owners),
      total: sum(everyone),
    };
  },
});
