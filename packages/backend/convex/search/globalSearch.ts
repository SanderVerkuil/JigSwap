import type { GlobalSearchResults } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";

// Global search: the single read behind the ⌘K command palette. Given a term it returns a small
// grouped result set across Puzzles, People, Circles and the signed-in member's Collections.
//
// Indexing strategy (documented intentionally):
//   - Puzzles      -> the existing `by_searchable_text` search index (approved-only). REAL index.
//   - People       -> the `by_searchable_name` search index over users.searchableName. REAL index.
//                     Results are then routed through the profile-visibility chokepoint so a member
//                     with a private profile is never surfaced by name/username/avatar to a searcher
//                     who is neither them nor a mutual follower (consistent with getProfile and the
//                     custody-timeline projectMemberIdentity chokepoint).
//   - Circles      -> the signed-in member's circles only (small set), in-memory name filter.
//   - Collections  -> the signed-in member's collections only (small set), in-memory name filter.
//
// Short/empty terms short-circuit to empty groups. Unauthenticated callers get empty groups too.

// We over-fetch people candidates from the search index (since some get dropped by the visibility
// gate) and stop once `limit` visible matches are collected.
const PEOPLE_CANDIDATE_LIMIT = 50;

const EMPTY: GlobalSearchResults = {
  puzzles: [],
  people: [],
  circles: [],
  collections: [],
};

export const global = query({
  args: { term: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<GlobalSearchResults> => {
    const limit = args.limit ?? 5;
    const term = args.term.toLowerCase().trim();
    // Empty / too-short terms return empty groups fast.
    if (term.length < 2) return EMPTY;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return EMPTY;

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!currentUser) return EMPTY;
    const memberId = currentUser._id as Id<"users">;

    // --- Puzzles: real search index, approved-only. ---
    const puzzleRows = await ctx.db
      .query("puzzles")
      .withSearchIndex("by_searchable_text", (q) =>
        q.search("searchableText", term).eq("status", "approved"),
      )
      .take(limit);
    const puzzles = await Promise.all(
      puzzleRows.map(async (row) => ({
        id: row._id,
        title: row.title,
        brand: row.brand,
        image: row.image ? await ctx.storage.getUrl(row.image) : null,
        href: `/puzzles/${row._id}`,
      })),
    );

    // --- People: real search index + profile-visibility gate. ---
    const candidates = await ctx.db
      .query("users")
      .withSearchIndex("by_searchable_name", (q) =>
        q.search("searchableName", term),
      )
      .take(PEOPLE_CANDIDATE_LIMIT);
    const people: GlobalSearchResults["people"] = [];
    for (const u of candidates) {
      if (people.length >= limit) break;
      if (u._id === memberId) continue;
      // Privacy chokepoint: only surface a member if their profile is public, or
      // they are a mutual follower of the searcher. Mirrors getProfile and the
      // custody-timeline projectMemberIdentity rules so a private member is not
      // identifiable by name/username/avatar via ⌘K.
      const visible =
        (await profileVisibilityOf(ctx, u._id)) === "public" ||
        (await areMutualFollowers(ctx, memberId, u._id));
      if (!visible) continue;
      people.push({
        id: u._id,
        name: u.name,
        image: u.avatar ?? null,
        // Canonical member page; username-first, id fallback (matches the
        // /members/$handle resolution rules).
        href: `/members/${u.username ?? u._id}`,
      });
    }

    // --- Circles: the member's own circles, in-memory name filter. ---
    const circleLinks = await ctx.db
      .query("circleMembers")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect();
    const circleRows = await Promise.all(
      circleLinks.map((link) =>
        ctx.db
          .query("circles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", link.circleAggregateId),
          )
          .unique(),
      ),
    );
    const circles = circleRows
      .filter(
        (row): row is NonNullable<typeof row> =>
          row !== null && row.name.toLowerCase().includes(term),
      )
      .slice(0, limit)
      .map((row) => ({ id: row._id, name: row.name, href: "/circles" }));

    // --- Collections: the member's collections, in-memory name filter. ---
    const collectionRows = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", memberId))
      .collect();
    const collections = collectionRows
      .filter((row) => row.name.toLowerCase().includes(term))
      .slice(0, limit)
      .map((row) => ({
        id: row._id,
        name: row.name,
        href: `/collections/${row._id}`,
      }));

    return { puzzles, people, circles, collections };
  },
});
