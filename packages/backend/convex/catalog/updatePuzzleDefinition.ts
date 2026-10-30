import {
  makeUpdatePuzzleDefinition,
  toCatalogCategoryId,
  toPuzzleDefinitionId,
  type PuzzleDefinitionChanges,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { assertBoxArtImage } from "./boxArtUploads";
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
  },
  handler: async (ctx, args) => {
    const actingMember = await requireMember(ctx);

    const definitions = convexPuzzleDefinitionRepository(ctx);

    // ACL: an admin may edit any definition. A submitter may edit their own definition only
    // while it is still pending; once moderated, it changes only through a change proposal
    // (proposeDefinitionChange) or an admin edit, never silently by its submitter.
    const existing = await definitions.findById(
      toPuzzleDefinitionId(args.puzzleDefinitionId),
    );
    if (!existing) throw new ConvexError("Not found");
    const { submittedBy, status } = existing.toState();
    const isSubmitter =
      (submittedBy as unknown as string) ===
      (actingMember as unknown as string);
    if (!(await isAdmin(ctx)) && !(isSubmitter && status === "pending")) {
      throw new ConvexError("Forbidden");
    }
    // An admin editing someone ELSE's definition is a moderation act; stamp it after success.
    // Submitter self-edits stay un-audited (unchanged behavior). The ACL above already
    // guaranteed that a non-submitter actor IS an admin.
    const isAdminEditingOthers = !isSubmitter;
    // A new image must be box art the server stripped of its metadata for this member.
    await assertBoxArtImage(
      ctx,
      args.image,
      actingMember as unknown as Id<"users">,
      [existing.toState().image],
    );

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

    const result = await update({
      puzzleDefinitionId: toPuzzleDefinitionId(args.puzzleDefinitionId),
      changes,
    });
    if (result.isErr) throw toConvexError(result.error);

    if (isAdminEditingOthers) {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", args.puzzleDefinitionId),
        )
        .unique();
      await stampModerationAction(ctx, {
        actorId: actingMember as unknown as Id<"users">,
        kind: "definition_edited",
        targetLabel: row?.title ?? args.puzzleDefinitionId,
        targetId: args.puzzleDefinitionId,
      });
    }
  },
});
