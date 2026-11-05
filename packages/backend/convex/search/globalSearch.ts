import type { GlobalSearchResults } from "@jigswap/contracts";
import { puzzleSearchTerm } from "@jigswap/domain";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { optionalActingMember } from "../identity/optionalActingMember";
import { boxArtThumbUrl } from "../lib/imageModeration/boxArtUrl";
import { clampLimit } from "../lib/pageSize";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { blockedEitherWaySet } from "../social/blocks";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";

// Global search: the single read behind the ⌘K command palette. Given a term it returns a small
// grouped result set across Puzzles, the signed-in member's own Copies, People, Circles and the
// signed-in member's Collections.
//
// Indexing strategy (documented intentionally):
//   - Puzzles      -> the existing `by_searchable_text` search index (approved-only). REAL index.
//   - Copies       -> the signed-in member's OWN copies only (any visibility: they are theirs), the
//                     newest COPY_SCAN_LIMIT via `by_owner`, in-memory match on the copy's cached
//                     title/brand. A bounded read: in a larger library only the newest are searched
//                     (My Puzzles' own search covers the whole library). Never another member's copy.
//   - People       -> the `by_searchable_name` search index over users.searchableName. REAL index.
//                     Results are then routed through the profile-visibility chokepoint so a member
//                     with a private profile is never surfaced by name/username/avatar to a searcher
//                     who is neither them nor a mutual follower (consistent with getProfile and the
//                     custody-timeline projectMemberIdentity chokepoint).
//   - Circles      -> the signed-in member's circles only (small set), in-memory name filter.
//   - Collections  -> the signed-in member's collections only (small set), in-memory name filter.
//
// Short/empty terms short-circuit to empty groups. Unauthenticated, unknown and deactivated
// callers get empty groups too.

// We over-fetch people candidates from the search index (since some get dropped by the visibility
// gate) and stop once `limit` visible matches are collected.
const PEOPLE_CANDIDATE_LIMIT = 50;

// Each group holds 1 to MAX_LIMIT results whatever the client asks for (default DEFAULT_LIMIT).
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

// How many of the member's newest copies the "In your library" group looks through.
export const COPY_SCAN_LIMIT = 500;

// Lowercased with accents stripped, so "creme" finds "Crème".
const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const EMPTY: GlobalSearchResults = {
  puzzles: [],
  copies: [],
  people: [],
  circles: [],
  collections: [],
};

export const global = query({
  args: { term: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<GlobalSearchResults> => {
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_LIMIT,
      max: MAX_LIMIT,
    });
    const term = args.term.toLowerCase().trim();
    // Empty / too-short terms return empty groups fast.
    if (term.length < 2) return EMPTY;

    const memberId = await optionalActingMember(ctx);
    if (!memberId) return EMPTY;

    // --- Puzzles: real search index, approved-only. ---
    const puzzleRows = await ctx.db
      .query("puzzles")
      .withSearchIndex("by_searchable_text", (q) =>
        q
          .search("searchableText", puzzleSearchTerm(term))
          .eq("status", "approved"),
      )
      .take(limit);
    const puzzles = await Promise.all(
      puzzleRows.map(async (row) => ({
        id: row._id,
        title: row.title,
        brand: row.brand,
        image: row.image ? await boxArtThumbUrl(ctx, row.image) : null,
        href: `/puzzles/${row._id}`,
      })),
    );

    // --- Copies: the member's own copies, newest first, bounded; in-memory title/brand match. ---
    const words = fold(term).split(/\s+/).filter(Boolean);
    const copyRows = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .order("desc")
      .take(COPY_SCAN_LIMIT);
    const copies: GlobalSearchResults["copies"] = [];
    for (const copy of copyRows) {
      if (copies.length >= limit) break;
      // The copy's cached catalogue snapshot; only a legacy row without one reads its puzzle here.
      const legacyPuzzle = copy.snapshot
        ? null
        : await ctx.db.get(copy.puzzleId);
      const title = copy.snapshot?.title ?? legacyPuzzle?.title;
      if (!title) continue;
      const brand = copy.snapshot?.brand ?? legacyPuzzle?.brand;
      const haystack = fold(`${title}\n${brand ?? ""}`);
      if (!words.every((word) => haystack.includes(word))) continue;
      const puzzle = legacyPuzzle ?? (await ctx.db.get(copy.puzzleId));
      copies.push({
        id: copy._id,
        title,
        brand,
        image: await resolveCopyCoverUrl(ctx, copy, puzzle),
        href: `/my-puzzles/${copy._id}`,
      });
    }

    // --- People: real search index + profile-visibility gate. ---
    const candidates = await ctx.db
      .query("users")
      .withSearchIndex("by_searchable_name", (q) =>
        q.search("searchableName", term),
      )
      .take(PEOPLE_CANDIDATE_LIMIT);
    // Members blocked either way with the searcher are never surfaced (spec 2.6).
    const blockedIds = await blockedEitherWaySet(ctx, memberId);
    const people: GlobalSearchResults["people"] = [];
    for (const u of candidates) {
      if (people.length >= limit) break;
      if (u._id === memberId || blockedIds.has(u._id)) continue;
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
        name: memberDisplayNameOf(u),
        image: u.avatar ?? null,
        // Slug, else id: never the username, which another member may hold
        // as a slug (SEC-07). The route redirects to the canonical handle.
        href: `/members/${u.slug ?? u._id}`,
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

    return { puzzles, copies, people, circles, collections };
  },
});
