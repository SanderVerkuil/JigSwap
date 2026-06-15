import type {
  CopyOfferSwapType,
  CopyOfferView,
  PuzzleDefinitionDetailView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { profileVisibilityOf } from "../social/privacy";
import { collectCircleSharedCopies } from "./circleSharedCopies";

const MS_PER_DAY = 86_400_000;

// Round to 1 decimal place.
const round1 = (n: number): number => Math.round(n * 10) / 10;

// Whole-day solve duration: prefer (endDate - startDate) rounded to whole days; else fall back to
// completionTimeMinutes / 1440 rounded; else null when neither is recorded. Mirrors getCopyInstanceView.
const finishDaysOf = (c: {
  startDate: number;
  endDate?: number;
  completionTimeMinutes?: number;
}): number | null => {
  if (c.endDate != null) {
    return Math.round((c.endDate - c.startDate) / MS_PER_DAY);
  }
  if (c.completionTimeMinutes != null) {
    return Math.round(c.completionTimeMinutes / 1440);
  }
  return null;
};

// A copy is "open" iff at least one exchange-availability flag is set (identical to browseOwnedPuzzles).
const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

// Availability priority -> swapType, matching the contract: forTrade -> "swap", forLend -> "lend",
// forSale -> "sale" (first set wins). A reachable available copy always has at least one flag set.
const swapTypeOf = (copy: Doc<"ownedPuzzles">): CopyOfferSwapType => {
  if (copy.availability.forTrade) return "swap";
  if (copy.availability.forLend) return "lend";
  return "sale";
};

// The category name is a localized object `{ en, nl }` on adminCategories; the catalog reads carry it
// whole. Here the detail page wants a single string, so we pick English. Defensive against legacy/raw
// string shapes.
const categoryNameOf = (
  row: Doc<"adminCategories"> | null,
): string | undefined => {
  if (!row) return undefined;
  const name = row.name as unknown;
  if (typeof name === "string") return name;
  if (name && typeof name === "object" && "en" in name) {
    const en = (name as { en?: unknown }).en;
    if (typeof en === "string") return en;
  }
  return undefined;
};

// Auth-gated catalog detail read for a puzzle DEFINITION (not a single copy). Aggregates the
// community's review-rating distribution, ownership/completion stats, the viewer's own ownership, and
// a short list of REACHABLE available copies the viewer could acquire. The reachability gate —
// owner profile PUBLIC, OR the copy is shared into a circle the viewer belongs to — is replicated
// from browseOwnedPuzzles/circleSharedCopies so this matches Browse exactly. Returns null for an
// unknown puzzle.
export const getPuzzleDefinitionView = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args): Promise<PuzzleDefinitionDetailView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) return null;

    // --- definition (catalog facts) -----------------------------------------------------------
    const image = puzzle.image
      ? ((await ctx.storage.getUrl(puzzle.image)) ?? undefined)
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

    // --- rating (over `puzzleComments` that carry a rating — these ARE the reviews) ------------
    const comments = await ctx.db
      .query("puzzleComments")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
      .collect();
    // Community rating draws on DEFINITION-level reviews only; copy-scoped comments (copyId set) are
    // a copy owner's private rating and never feed the shared community score.
    const ratedReviews = comments.filter(
      (c) => c.rating != null && c.copyId == null,
    );
    // breakdown index 0..4 == [5★,4★,3★,2★,1★].
    const breakdown: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let ratingSum = 0;
    for (const c of ratedReviews) {
      const r = c.rating as number;
      ratingSum += r;
      const bucket = 5 - r; // r=5 -> 0, r=1 -> 4
      if (bucket >= 0 && bucket <= 4) breakdown[bucket] += 1;
    }
    const ratingCount = ratedReviews.length;
    const pct = (n: number): number =>
      ratingCount > 0 ? Math.round((n / ratingCount) * 100) : 0;
    const percentages: [number, number, number, number, number] = [
      pct(breakdown[0]),
      pct(breakdown[1]),
      pct(breakdown[2]),
      pct(breakdown[3]),
      pct(breakdown[4]),
    ];
    const rating = {
      rating: ratingCount > 0 ? round1(ratingSum / ratingCount) : 0,
      count: ratingCount,
      breakdown,
      percentages,
    };

    // --- ownedPuzzles for this definition (drives owners count, viewer ownership, copies) -------
    const owned = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
      .collect();

    const distinctOwners = new Set(
      owned.map((c) => c.ownerId as unknown as string),
    );

    // --- completions of the definition (totalCompletions, avgCompletionDays) --------------------
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", args.puzzleId))
      .collect();
    const completed = completions.filter((c) => c.isCompleted);
    const finishDaysList = completed
      .map(finishDaysOf)
      .filter((d): d is number => d != null);
    const avgCompletionDays =
      finishDaysList.length > 0
        ? round1(
            finishDaysList.reduce((s, d) => s + d, 0) / finishDaysList.length,
          )
        : null;

    // --- reachability gate (replicated from browseOwnedPuzzles/circleSharedCopies) --------------
    // An available copy is shown iff its owner's profile is PUBLIC, OR the copy is shared into a
    // circle the viewer belongs to. The viewer's own copies are excluded.
    const circleShared = (
      await collectCircleSharedCopies(ctx, viewerId)
    ).filter(isOpen);
    const circleSharedIds = new Set(
      circleShared.map((c) => c._id as unknown as string),
    );

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

    // Candidate available copies of THIS definition, not the viewer's own, that are open.
    const availableNotOwn = owned.filter(
      (c) => c.ownerId !== viewerId && isOpen(c),
    );

    const reachable: Doc<"ownedPuzzles">[] = [];
    for (const copy of availableNotOwn) {
      const id = copy._id as unknown as string;
      if (circleSharedIds.has(id) || (await ownerIsPublic(copy.ownerId))) {
        reachable.push(copy);
      }
    }
    // Newest first.
    reachable.sort((a, b) => b.createdAt - a.createdAt);

    const totalAvailable = reachable.length;
    const availableToSwap = totalAvailable;

    // --- resolve each distinct owner once (user row + reputation avg), cached ------------------
    const ownerCache = new Map<
      string,
      Promise<{
        name: string;
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
        const user = await ctx.db.get(ownerId);
        const reputation = await ctx.db
          .query("reputationProfiles")
          .withIndex("by_member", (q) => q.eq("memberId", ownerId))
          .unique();
        const avgRating =
          reputation && reputation.reviewCount > 0
            ? reputation.averageRating
            : null;
        return {
          name: user?.name ?? "Member",
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
        communityOwners: distinctOwners.size,
        totalCompletions: completed.length,
        avgCompletionDays,
        availableToSwap,
      },
      ownership,
      availableCopies,
      totalAvailable,
    };
  },
});
