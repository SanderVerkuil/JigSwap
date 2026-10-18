import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { projectTradeParty, type TradePartyMemo } from "../exchange/tradeParty";
import { requireMember } from "../identity/requireMember";
import { onboardingRowOf } from "../onboarding/memberOnboarding";

// Per-context cap on rows pulled into a single export. Convex queries have a read budget; a member
// with a very large history is capped so the export stays a single, bounded query return. The UI
// download is "most of your data" rather than a guaranteed-complete archive when capped.
const EXPORT_LIMIT = 5000;

// Exchange rows as the exporting member may see them: a counterparty who is hidden from them in
// that trade (a private owner who has not accepted or replied to it yet — exchange/tradeParty) has
// their raw id OMITTED, exactly like the exchange views. Counterparty facts are memoized, so a long
// history costs a few reads per partner plus one point read per exchange.
const exportableExchanges = async (
  ctx: QueryCtx,
  userId: Id<"users">,
  rows: Doc<"exchanges">[],
) => {
  const memo: TradePartyMemo = new Map();
  const out = [];
  for (const row of rows) {
    const { initiatorId, recipientId, ...rest } = row;
    const hidden = async (party: Id<"users">) =>
      (await projectTradeParty(ctx, userId, row, party, memo)).state ===
      "hidden";
    out.push({
      ...rest,
      ...((await hidden(initiatorId)) ? {} : { initiatorId }),
      ...((await hidden(recipientId)) ? {} : { recipientId }),
    });
  }
  return out;
};

// Insights read query: a JSON-serialisable bundle of the member's own data for a client-side
// download (GDPR-style export). Read-only; resolves a few FK ids (puzzle titles) where cheap.
export const exportUserData = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    const user = await ctx.db.get(userId);

    const [
      completions,
      copies,
      collections,
      goals,
      reviewsGiven,
      puzzleReviews,
      copyReviews,
      exchangesA,
      exchangesB,
      quickStart,
    ] = await Promise.all([
      ctx.db
        .query("completions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(EXPORT_LIMIT),
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .take(EXPORT_LIMIT),
      ctx.db
        .query("collections")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(EXPORT_LIMIT),
      ctx.db
        .query("goals")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(EXPORT_LIMIT),
      ctx.db
        .query("reviews")
        .withIndex("by_reviewer", (q) => q.eq("reviewerId", userId))
        .take(EXPORT_LIMIT),
      // Two-level review model: the member's catalog-puzzle reviews and physical-copy reviews.
      ctx.db
        .query("puzzleReviews")
        .withIndex("by_user_puzzle", (q) => q.eq("userId", userId))
        .take(EXPORT_LIMIT),
      ctx.db
        .query("copyReviews")
        .withIndex("by_user_copy", (q) => q.eq("userId", userId))
        .take(EXPORT_LIMIT),
      ctx.db
        .query("exchanges")
        .withIndex("by_initiator", (q) => q.eq("initiatorId", userId))
        .take(EXPORT_LIMIT),
      ctx.db
        .query("exchanges")
        .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
        .take(EXPORT_LIMIT),
      onboardingRowOf(ctx, userId),
    ]);

    // Resolve puzzle titles for the completions and copies (de-duplicated) so the export reads
    // without opaque ids. Cheap: one get per distinct puzzle.
    const puzzleIds = [
      ...new Set([
        ...completions
          .map((c) => c.puzzleId)
          .filter((id): id is Id<"puzzles"> => !!id),
        ...copies.map((c) => c.puzzleId),
      ]),
    ];
    const puzzles = await Promise.all(puzzleIds.map((id) => ctx.db.get(id)));
    const titleByPuzzle = new Map<Id<"puzzles">, string>(
      puzzleIds.map((id, i) => [id, puzzles[i]?.title ?? "Unknown"]),
    );

    return {
      exportedAt: Date.now(),
      // The export is capped at EXPORT_LIMIT rows per collection; surfaced so the UI can warn.
      limitPerCollection: EXPORT_LIMIT,
      user: user
        ? {
            email: user.email,
            name: user.name,
            username: user.username,
            bio: user.bio,
            location: user.location,
            createdAt: user.createdAt,
          }
        : null,
      completions: completions.map((c) => ({
        ...c,
        puzzleTitle: c.puzzleId ? titleByPuzzle.get(c.puzzleId) : undefined,
      })),
      ownedPuzzles: copies.map((c) => ({
        ...c,
        puzzleTitle: titleByPuzzle.get(c.puzzleId),
      })),
      collections,
      goals,
      reviewsGiven,
      puzzleReviews,
      copyReviews,
      exchanges: await exportableExchanges(ctx, userId, [
        ...exchangesA,
        ...exchangesB,
      ]),
      // Quick start choices (skipped steps, dismissals), or null when never set.
      quickStart,
    };
  },
});
