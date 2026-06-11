import {
  type AcquisitionSource,
  type Condition,
  makeAcquireCopy,
  type OwnerId,
  Price,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCatalogSnapshotProvider } from "./adapters/convexCatalogSnapshotProvider";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
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
const acquisitionSource = v.union(
  v.literal("bought_new"),
  v.literal("bought_used"),
  v.literal("trade"),
  v.literal("gift"),
);
const price = v.object({ amountCents: v.number(), currency: v.string() });

// Composition root for acquiring a copy: authenticate (owner from auth) -> wire adapters ->
// fetch the Catalog snapshot via the provider inside the use case -> persist -> return the
// new CopyId (aggregateId). Identifiers in args are domain aggregateIds (strings).
export const acquireCopy = mutation({
  args: {
    puzzleDefinitionId: v.string(),
    condition,
    missingPiecesCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    acquisition: v.optional(
      v.object({
        date: v.optional(v.number()),
        source: v.optional(acquisitionSource),
        price: v.optional(price),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ownerId = (await requireMember(ctx)) as unknown as OwnerId;

    const acquire = makeAcquireCopy({
      copies: convexCopyRepository(ctx),
      snapshots: convexCatalogSnapshotProvider(ctx),
      ids: copyIdGenerator,
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await acquire({
      ownerId,
      puzzleDefinitionId: toPuzzleDefinitionId(args.puzzleDefinitionId),
      condition: args.condition as Condition,
      missingPiecesCount: args.missingPiecesCount,
      notes: args.notes,
      acquisition: args.acquisition
        ? {
            date:
              args.acquisition.date === undefined
                ? undefined
                : new Date(args.acquisition.date),
            source: args.acquisition.source as AcquisitionSource | undefined,
            // A supplied acquisition price is validated by the Price VO; reject if malformed.
            price: resolvePrice(args.acquisition.price),
          }
        : undefined,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});

// Build a validated Price from the optional args, throwing the domain's InvalidPrice on failure.
const resolvePrice = (
  input: { amountCents: number; currency: string } | undefined,
): Price | undefined => {
  if (!input) return undefined;
  const result = Price.create(input.amountCents, input.currency);
  if (result.isErr) throw toConvexError(result.error);
  return result.value;
};
