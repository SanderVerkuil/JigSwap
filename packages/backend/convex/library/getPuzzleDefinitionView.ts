import type {
  CopyOfferView,
  PuzzleDefinitionDetailView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { canViewDefinition } from "../catalog/definitionVisibility";
import { householdMateIds } from "../household/memberships";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { blockedEitherWaySet } from "../social/blocks";
import { profileVisibilityOf, projectMemberIdentity } from "../social/privacy";
import { isCircleSharedWithViewer } from "./circleSharedCopies";
import { isCopyPrivate } from "./copyVisibility";
import {
  categoryNameOf,
  communityOwnersOf,
  completionStatsFromTotals,
  completionStatsOf,
  ratingBreakdownFromTotals,
  ratingBreakdownOf,
  swapTypeOf,
} from "./definitionAggregates";
import { definitionTotalsOf } from "./definitionStats";
import { openListingWindow } from "./openListing";

// The view's window of reachable open copies of the definition (library/openListing
// .openListingWindow): at most DEFINITION_CANDIDATE_CAP, newest first. One owner's copies past
// DEFINITION_PER_OWNER only fill room the other owners leave, reading stops after
// DEFINITION_READ_BUDGET rows or DEFINITION_CANDIDATE_CAP owners, and at most
// DEFINITION_CANDIDATE_CAP per-copy circle checks run (a private owner's copy past that is not
// offered). Past the window, `totalAvailable` (and stats.availableToSwap) is a lower bound.
export const DEFINITION_CANDIDATE_CAP = 200;
export const DEFINITION_PER_OWNER = 20;
export const DEFINITION_READ_BUDGET = 3 * DEFINITION_CANDIDATE_CAP;

// Auth-gated catalog detail read for a puzzle DEFINITION (not a single copy). Aggregates the
// community's review-rating distribution, ownership/completion stats, the viewer's own ownership, and
// a short list of REACHABLE available copies the viewer could acquire. The reachability gate —
// owner profile PUBLIC, OR the copy is shared into a circle the viewer belongs to — mirrors
// browseOwnedPuzzles, but decides the circle clause per copy (isCircleSharedWithViewer, uncapped in
// effect) where Browse uses the capped batched collector, so a copy shared long ago into a very busy
// circle can appear here and not in Browse. Returns null for an unknown puzzle, and for a definition
// that is not approved unless the viewer submitted it or is an admin (canViewDefinition, the same
// gate as getPuzzleById), so unmoderated, rejected or disabled catalogue text is not served by id.
//
// Bounded reads: the rating, owner and completion numbers come from the definition's
// definitionStats row (library/definitionStats), plus the viewer's household's private-only
// owners; the reachable list from the newest DEFINITION_CANDIDATE_CAP open copies
// (library/openListing), which no single owner can crowd. Until the definition's first recompute
// the numbers are computed live.
export const getPuzzleDefinitionView = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleDefinitionDetailView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) return null;
    if (!(await canViewDefinition(ctx, puzzle, viewerId))) return null;

    // --- definition (catalog facts) -----------------------------------------------------------
    const image = puzzle.image
      ? ((await boxArtUrl(ctx, puzzle.image)) ?? undefined)
      : undefined;
    const categoryRow = puzzle.category
      ? await ctx.db.get(puzzle.category)
      : null;
    const definition = {
      title: puzzle.title,
      brand: puzzle.brand,
      pieceCount: puzzle.pieceCount,
      image,
      difficulty: puzzle.difficulty,
      categoryName: categoryNameOf(categoryRow),
      tags: puzzle.tags ?? [],
      description: puzzle.description,
    };

    // --- rating, owners and completions --------------------------------------------------------
    // Owners count: private copies only count for the viewer's own and their household's.
    const mates = await householdMateIds(ctx, viewerId);
    const seesPrivateOf = (ownerId: Id<"users">) =>
      ownerId === viewerId || mates.has(ownerId);
    const aggregatesOf = async () => {
      const totals = await definitionTotalsOf(ctx, args.puzzleId);
      if (!totals) {
        const owned = await ctx.db
          .query("ownedPuzzles")
          .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
          .collect();
        return {
          rating: await ratingBreakdownOf(ctx, args.puzzleId),
          communityOwners: communityOwnersOf(owned, seesPrivateOf),
          ...(await completionStatsOf(ctx, args.puzzleId, owned)),
        };
      }
      // The stored count has every owner of a copy that is not private; add the viewer and their
      // housemates who hold only private copies of this definition.
      let privateOnlyOwners = 0;
      for (const memberId of [viewerId, ...mates]) {
        const copies = await ctx.db
          .query("ownedPuzzles")
          .withIndex("by_owner_puzzle", (q) =>
            q.eq("ownerId", memberId).eq("puzzleId", args.puzzleId),
          )
          .collect();
        if (copies.length > 0 && copies.every(isCopyPrivate)) {
          privateOnlyOwners++;
        }
      }
      return {
        rating: ratingBreakdownFromTotals(totals),
        communityOwners: totals.communityOwners + privateOnlyOwners,
        ...completionStatsFromTotals(totals),
      };
    };
    const { rating, communityOwners, totalCompletions, avgCompletionDays } =
      await aggregatesOf();

    // --- reachability gate (replicated from browseOwnedPuzzles/circleSharedCopies) --------------
    // An available copy is shown iff its owner's profile is PUBLIC, OR the copy is shared into a
    // circle the viewer belongs to. The viewer's own copies are excluded. The circle clause is
    // checked per candidate copy (O(shares of that copy), #190), not via the batched collector.
    const visibilityCache = new Map<string, "public" | "private">();
    const ownerIsPublic = async (ownerId: Id<"users">): Promise<boolean> => {
      const key = ownerId as unknown as string;
      let cached = visibilityCache.get(key);
      if (cached === undefined) {
        cached = await profileVisibilityOf(ctx, ownerId);
        visibilityCache.set(key, cached);
      }
      return cached === "public";
    };

    // Copies of members blocked either way with the viewer are never offered (spec 2.6).
    const blockedIds = await blockedEitherWaySet(ctx, viewerId);
    // The circle clause costs queries per copy, so only so many run; past that a private owner's
    // copy is not offered (fails closed).
    let circleChecks = 0;
    const isReachable = async (copy: Doc<"ownedPuzzles">) => {
      if (copy.ownerId === viewerId || blockedIds.has(copy.ownerId)) {
        return false;
      }
      if (await ownerIsPublic(copy.ownerId)) return true;
      if (circleChecks >= DEFINITION_CANDIDATE_CAP) return false;
      circleChecks++;
      return isCircleSharedWithViewer(ctx, viewerId, copy);
    };
    // Reachable open copies of THIS definition, not the viewer's own, newest first.
    const reachable = (
      await openListingWindow(
        ctx,
        args.puzzleId,
        {
          size: DEFINITION_CANDIDATE_CAP,
          perOwner: DEFINITION_PER_OWNER,
          readBudget: DEFINITION_READ_BUDGET,
          maxOwners: DEFINITION_CANDIDATE_CAP,
        },
        isReachable,
      )
    ).rows.sort(
      (a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime,
    );

    const totalAvailable = reachable.length;
    const availableToSwap = totalAvailable;

    // --- resolve each distinct owner once (user row + reputation avg), cached ------------------
    const ownerCache = new Map<
      string,
      Promise<{
        name?: string;
        location: string | null;
        avatarUrl: string | null;
        avgRating: number | null;
      }>
    >();
    const resolveOwner = (ownerId: Id<"users">) => {
      const key = ownerId as unknown as string;
      const existing = ownerCache.get(key);
      if (existing) return existing;
      const p = (async () => {
        // Through the identity chokepoint: a hidden owner (e.g. departed) yields no name/avatar.
        // The salt is irrelevant here (no anonRef is surfaced).
        const projected = await projectMemberIdentity(
          ctx,
          viewerId,
          ownerId,
          args.puzzleId,
        );
        const user = projected.anonymous ? null : projected.member;
        const reputation = await ctx.db
          .query("reputationProfiles")
          .withIndex("by_member", (q) => q.eq("memberId", ownerId))
          .unique();
        const avgRating =
          reputation && reputation.reviewCount > 0
            ? reputation.averageRating
            : null;
        return {
          name: memberDisplayNameOf(user),
          location: user?.location ?? null,
          avatarUrl: user?.avatar ?? null,
          avgRating,
        };
      })();
      ownerCache.set(key, p);
      return p;
    };

    const availableCopies: CopyOfferView[] = await Promise.all(
      reachable.slice(0, 5).map(async (copy) => ({
        copyId: copy._id,
        swapType: swapTypeOf(copy),
        owner: await resolveOwner(copy.ownerId),
      })),
    );

    // --- ownership (does the viewer own a copy of this definition?) -----------------------------
    // A copy links to a definition by EITHER its resolved `puzzleId` FK OR (when that FK is stale
    // or unresolved) its domain `puzzleDefinitionId === puzzle.aggregateId`. The `owned` set above
    // is keyed only on `puzzleId`, so it can miss the viewer's copy. Query the viewer's own copies
    // (a small set) directly and match on either link, so ownership shows reliably.
    const viewerCopies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewerId))
      .collect();
    const viewerCopy =
      viewerCopies.find(
        (c) =>
          c.puzzleId === args.puzzleId ||
          (puzzle.aggregateId != null &&
            c.puzzleDefinitionId === puzzle.aggregateId),
      ) ?? null;
    const ownership = {
      viewerOwns: viewerCopy != null,
      copyId: viewerCopy ? (viewerCopy._id as string) : null,
      condition: viewerCopy ? viewerCopy.condition : null,
    };

    return {
      definition,
      rating,
      stats: {
        communityOwners,
        totalCompletions,
        avgCompletionDays,
        availableToSwap,
      },
      ownership,
      availableCopies,
      totalAvailable,
    };
  },
});
