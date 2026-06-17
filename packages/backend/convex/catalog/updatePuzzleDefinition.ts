import {
  makeUpdatePuzzleDefinition,
  type PuzzleDefinitionChanges,
  toCatalogCategoryId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for patching a definition's descriptive fields. Each supplied field replaces
// the stored value; the aggregate re-validates anything with an invariant (title/pieceCount/
// barcodes). Approval status and provenance are not patchable here.
export const updatePuzzleDefinition = mutation({
  args: {
    puzzleDefinitionId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.optional(v.number()),
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
    const actingMember = await requireMember(ctx);

    const definitions = convexPuzzleDefinitionRepository(ctx);

    // Ownership ACL: only the original submitter or an admin may edit a definition.
    const existing = await definitions.findById(
      toPuzzleDefinitionId(args.puzzleDefinitionId),
    );
    if (!existing) throw new ConvexError("Not found");
    const submittedBy = existing.toState().submittedBy as unknown as string;
    if (submittedBy !== (actingMember as unknown as string)) {
      if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    }

    const update = makeUpdatePuzzleDefinition({
      definitions,
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const hasBarcode =
      args.ean !== undefined ||
      args.upc !== undefined ||
      args.modelNumber !== undefined;
    const changes: PuzzleDefinitionChanges = {
      title: args.title,
      description: args.description,
      brand: args.brand,
      pieceCount: args.pieceCount,
      artist: args.artist,
      series: args.series,
      barcodes: hasBarcode
        ? { ean: args.ean, upc: args.upc, modelNumber: args.modelNumber }
        : undefined,
      dimensions: args.dimensions,
      shape: args.shape,
      difficulty: args.difficulty,
      category: args.category ? toCatalogCategoryId(args.category) : undefined,
      tags: args.tags,
      image: args.image,
    };

    const result = await update({
      puzzleDefinitionId: toPuzzleDefinitionId(args.puzzleDefinitionId),
      changes,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
