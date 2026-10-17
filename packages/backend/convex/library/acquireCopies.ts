import {
  makeAcquireCopy,
  makeUpdateCopySharing,
  planAcquireBatch,
  toPuzzleDefinitionId,
  type Condition,
  type OwnerId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { convexCopyManagerPolicy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { batchEventPublisher } from "./adapters/batchEventPublisher";
import { convexCatalogSnapshotProvider } from "./adapters/convexCatalogSnapshotProvider";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { convexCopyReservationPort } from "./adapters/convexCopyReservationPort";
import { libraryEventPublisher } from "./adapters/eventPublisher";
import { copyIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

const condition = v.union(
  v.literal("new_sealed"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("poor"),
);

// Composition root for the quick-start batch add: one copy per picked definition, owned by the
// caller. Each item runs the same makeAcquireCopy use case as acquireCopy (so the same catalogue
// rule applies: approved, or the caller's own submission). An item marked forTrade is then offered
// for swap through the same makeUpdateCopySharing use case as updateCopySharing. Any refusal throws,
// and one mutation is one transaction, so the batch is all or nothing. One call is one batch: its
// fresh batch id is on every CopyAcquired event (the activity feed groups them into one entry
// instead of one per box) and on every copy row it creates (provenance).
export const acquireCopies = mutation({
  args: {
    items: v.array(
      v.object({
        puzzleDefinitionId: v.string(),
        forTrade: v.optional(v.boolean()),
      }),
    ),
    condition: v.optional(condition),
  },
  handler: async (ctx, args): Promise<{ copyIds: string[] }> => {
    const ownerId = (await requireMember(ctx)) as unknown as OwnerId;

    const plan = planAcquireBatch(
      args.items.map((item) => ({
        puzzleDefinitionId: toPuzzleDefinitionId(item.puzzleDefinitionId),
        forTrade: item.forTrade,
      })),
    );
    if (plan.isErr) throw toConvexError(plan.error);

    const batchId = crypto.randomUUID();
    const acquire = makeAcquireCopy({
      copies: convexCopyRepository(ctx),
      snapshots: convexCatalogSnapshotProvider(ctx),
      ids: copyIdGenerator,
      events: batchEventPublisher(libraryEventPublisher(ctx), batchId),
      clock: systemClock,
    });
    const share = makeUpdateCopySharing({
      copies: convexCopyRepository(ctx),
      reservations: convexCopyReservationPort(ctx),
      events: libraryEventPublisher(ctx),
      clock: systemClock,
      managers: convexCopyManagerPolicy(ctx),
    });

    const copyIds: string[] = [];
    for (const item of plan.value) {
      const acquired = await acquire({
        ownerId,
        puzzleDefinitionId: item.puzzleDefinitionId,
        condition: (args.condition ?? "good") as Condition,
      });
      if (acquired.isErr) throw toConvexError(acquired.error);
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", acquired.value as string),
        )
        .unique();
      if (row) await ctx.db.patch(row._id, { acquisitionBatchId: batchId });

      if (item.forTrade) {
        const shared = await share({
          actingMemberId: ownerId,
          copyId: acquired.value,
          visibility: "visible",
          forTrade: true,
        });
        if (shared.isErr) throw toConvexError(shared.error);
      }
      copyIds.push(acquired.value as string);
    }
    return { copyIds };
  },
});
