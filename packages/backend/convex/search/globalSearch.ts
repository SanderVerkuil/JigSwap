import type { GlobalSearchResults } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";

// Global search: the single read behind the ⌘K command palette. Given a term it returns a small
// grouped result set across Puzzles, People, Circles and the signed-in member's Collections.
//
// Indexing strategy (documented intentionally):
//   - Puzzles      -> the existing `by_searchable_text` search index (approved-only). REAL index.
//   - People       -> NO name search index exists; we scan a BOUNDED set of active users
//                     (PEOPLE_SCAN_LIMIT) and filter in-memory by lowercased substring. This is a
//                     best-effort match, not exhaustive — see TODO in the report.
//   - Circles      -> the signed-in member's circles only (small set), in-memory name filter.
//   - Collections  -> the signed-in member's collections only (small set), in-memory name filter.
//
// Short/empty terms short-circuit to empty groups. Unauthenticated callers get empty groups too.

// How many active users to scan for the in-memory name match. Kept small on purpose; a proper
// `users` name search index would remove this bound (TODO).
const PEOPLE_SCAN_LIMIT = 50;

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

    // --- People: bounded scan + in-memory substring filter (no name index). ---
    const scanned = await ctx.db
      .query("users")
      .withIndex("by_clerk_id")
      .take(PEOPLE_SCAN_LIMIT);
    const people = scanned
      .filter(
        (u) =>
          u._id !== memberId &&
          (u.name.toLowerCase().includes(term) ||
            (u.username?.toLowerCase().includes(term) ?? false)),
      )
      .slice(0, limit)
      .map((u) => ({
        id: u._id,
        name: u.name,
        image: u.avatar ?? null,
        href: "/people",
      }));

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
