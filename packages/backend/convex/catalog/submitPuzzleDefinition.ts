import {
  makeSubmitPuzzleDefinition,
  type SubmitterId,
  toCatalogCategoryId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { catalogIdGenerator } from "./adapters/catalogIdGenerator";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for submitting a puzzle definition: authenticate -> wire adapters -> call
// the use case -> map result. All behaviour lives in the (Convex-free) domain/application layers.
//
// DIVERGENCE vs legacy puzzles.createPuzzle (FLAGGED for the 2d/product decision): the domain
// models a submission as `pending` (moderation), whereas legacy auto-approves. Modelled
// faithfully as pending here; legacy behaviour is left untouched.
export const submitPuzzleDefinition = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.number(),
    artist: v.optional(v.string()),
    series: v.optional(v.string()),
    ean: v.optional(v.string()),
    upc: v.optional(v.string()),
    modelNumber: v.optional(v.string()),
    dimensions: v.optional(
      v.object({
        width: v.number(),
        height: v.number(),
        unit: v.union(v.literal("cm"), v.literal("in")),
      }),
    ),
    shape: v.optional(
      v.union(
        v.literal("rectangular"),
        v.literal("panoramic"),
        v.literal("round"),
        v.literal("shaped"),
      ),
    ),
    difficulty: v.optional(
      v.union(
        v.literal("easy"),
        v.literal("medium"),
        v.literal("hard"),
        v.literal("expert"),
      ),
    ),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const submittedBy = await requireMember(ctx); // submitter derived from auth, never the client

    const submit = makeSubmitPuzzleDefinition({
      definitions: convexPuzzleDefinitionRepository(ctx),
      ids: catalogIdGenerator,
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await submit({
      title: args.title,
      pieceCount: args.pieceCount,
      submittedBy: submittedBy as unknown as SubmitterId,
      description: args.description,
      brand: args.brand,
      artist: args.artist,
      series: args.series,
      barcodes: { ean: args.ean, upc: args.upc, modelNumber: args.modelNumber },
      dimensions: args.dimensions,
      shape: args.shape,
      difficulty: args.difficulty,
      category: args.category ? toCatalogCategoryId(args.category) : undefined,
      tags: args.tags,
      image: args.image,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
