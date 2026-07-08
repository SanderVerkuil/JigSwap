import type {
  AdminPuzzleDefinitionDetailView,
  AdminPuzzleDefinitionOwnerView,
} from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin read model for ONE catalog definition: the getUserDetail counterpart on the
// catalog side. Definition facts + submitter, ownership stats and a capped distinct-owners
// rollup (ownedPuzzles.by_puzzle), and the definition's moderation trail
// (moderationActions.by_target on the Catalog aggregateId — the id stampModerationAction
// writes for definition rows; legacy rows without an aggregateId get an empty trail).
// Admin-only, gated exactly like listPuzzleDefinitions. Owners capped, newest-first audit
// capped (no pagination in v1, same as the user detail view).

const OWNERS_CAP = 50;
const AUDIT_CAP = 20;

export const getPuzzleDefinitionDetail = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (
    ctx,
    { puzzleId },
  ): Promise<AdminPuzzleDefinitionDetailView> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const puzzle = await ctx.db.get(puzzleId);
    if (!puzzle) throw new ConvexError("Puzzle definition not found");

    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
      .collect();

    // Group copies per owner, rolling up the availability flags (true when ANY
    // of that member's copies has the flag). Map preserves insertion order.
    const perOwner = new Map<
      Id<"users">,
      Pick<
        AdminPuzzleDefinitionOwnerView,
        "copyCount" | "forTrade" | "forSale" | "forLend"
      >
    >();
    for (const copy of copies) {
      const agg = perOwner.get(copy.ownerId) ?? {
        copyCount: 0,
        forTrade: false,
        forSale: false,
        forLend: false,
      };
      agg.copyCount += 1;
      agg.forTrade = agg.forTrade || copy.availability.forTrade;
      agg.forSale = agg.forSale || copy.availability.forSale;
      agg.forLend = agg.forLend || copy.availability.forLend;
      perOwner.set(copy.ownerId, agg);
    }

    const owners = (
      await Promise.all(
        [...perOwner.entries()]
          .slice(0, OWNERS_CAP)
          .map(
            async ([
              ownerId,
              agg,
            ]): Promise<AdminPuzzleDefinitionOwnerView | null> => {
              const owner = await ctx.db.get(ownerId);
              // A deleted owner row contributes to the stats but not the list.
              if (!owner) return null;
              return {
                _id: ownerId as string,
                name: owner.name,
                username: owner.username,
                avatar: owner.avatar,
                ...agg,
              };
            },
          ),
      )
    ).filter(
      (owner): owner is AdminPuzzleDefinitionOwnerView => owner !== null,
    );

    const submitter = await ctx.db.get(puzzle.submittedBy);

    const auditRows = puzzle.aggregateId
      ? await ctx.db
          .query("moderationActions")
          .withIndex("by_target", (q) => q.eq("targetId", puzzle.aggregateId!))
          .order("desc")
          .take(AUDIT_CAP)
      : [];
    const audit = await Promise.all(
      auditRows.map(async (row) => ({
        kind: row.kind,
        actorName: row.actorId
          ? ((await ctx.db.get(row.actorId))?.name ?? null)
          : null,
        targetLabel: row.targetLabel,
        targetId: row.targetId,
        at: row.at,
      })),
    );

    return {
      definition: {
        _id: puzzle._id,
        aggregateId: puzzle.aggregateId,
        title: puzzle.title,
        brand: puzzle.brand,
        pieceCount: puzzle.pieceCount,
        status: puzzle.status,
        createdAt: puzzle.createdAt,
        updatedAt: puzzle.updatedAt,
        image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null,
        submitter: submitter
          ? { _id: submitter._id, name: submitter.name }
          : null,
      },
      stats: {
        ownerCount: perOwner.size,
        copies: {
          total: copies.length,
          forTrade: copies.filter((c) => c.availability.forTrade).length,
          forSale: copies.filter((c) => c.availability.forSale).length,
          forLend: copies.filter((c) => c.availability.forLend).length,
        },
      },
      owners,
      audit,
    };
  },
});
