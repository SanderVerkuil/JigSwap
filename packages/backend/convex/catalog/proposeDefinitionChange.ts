import {
  makeFileChangeProposal,
  type PuzzleDefinitionChanges,
  toCatalogCategoryId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { catalogIdGenerator } from "./adapters/catalogIdGenerator";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// The proposable field args, shared verbatim by proposeDefinitionChange and editChangeProposal.
// Mirrors updatePuzzleDefinition's args (grouped-barcode semantics included).
export const proposalFieldArgs = {
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  brand: v.optional(v.string()),
  publisher: v.optional(v.string()),
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
} as const;

type ProposalFieldArgs = {
  title?: string;
  description?: string;
  brand?: string;
  publisher?: string;
  pieceCount?: number;
  artist?: string;
  series?: string;
  ean?: string;
  upc?: string;
  modelNumber?: string;
  dimensions?: { width: number; height: number; unit: "cm" | "in" };
  shape?: "rectangular" | "panoramic" | "round" | "shaped";
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: string;
  tags?: string[];
  image?: string;
};

// Fold the flat mutation args into the domain patch shape (same grouped-barcode rule as
// updatePuzzleDefinition: any barcode arg present replaces the whole group).
export const toChanges = (args: ProposalFieldArgs): PuzzleDefinitionChanges => {
  const hasBarcode =
    args.ean !== undefined ||
    args.upc !== undefined ||
    args.modelNumber !== undefined;
  return {
    title: args.title,
    description: args.description,
    brand: args.brand,
    publisher: args.publisher,
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
};

// Composition root: any signed-in member proposes a field diff against an APPROVED definition.
// Cross-aggregate rules (approved-only, one open proposal per member+definition) live in the
// use case; this root only authenticates and adapts transport ⇄ domain.
export const proposeDefinitionChange = mutation({
  args: {
    puzzleDefinitionId: v.string(),
    comment: v.optional(v.string()),
    ...proposalFieldArgs,
  },
  handler: async (ctx, args) => {
    const actingMember = await requireMember(ctx);

    const file = makeFileChangeProposal({
      proposals: convexChangeProposalRepository(ctx),
      definitions: convexPuzzleDefinitionRepository(ctx),
      ids: catalogIdGenerator,
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await file({
      puzzleDefinitionId: toPuzzleDefinitionId(args.puzzleDefinitionId),
      proposedBy: toSubmitterId(actingMember as unknown as string),
      changes: toChanges(args),
      comment: args.comment,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
