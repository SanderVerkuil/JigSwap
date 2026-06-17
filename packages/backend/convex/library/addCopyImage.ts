import {
  type CopyImageTag,
  makeAddCopyImage,
  type OwnerId,
  toCopyId,
  toFileId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { libraryEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for attaching a photo to a copy. `copyId` is the domain aggregateId; `fileId`
// is a `_storage` ref the domain carries as an opaque handle.
export const addCopyImage = mutation({
  args: {
    copyId: v.string(),
    fileId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    tag: v.optional(
      v.union(
        v.literal("box_front"),
        v.literal("box_back"),
        v.literal("pieces"),
        v.literal("completed"),
        v.literal("damage_detail"),
      ),
    ),
    takenAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const add = makeAddCopyImage({
      copies: convexCopyRepository(ctx),
      events: libraryEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await add({
      actingMemberId,
      copyId: toCopyId(args.copyId),
      fileId: toFileId(args.fileId),
      title: args.title,
      description: args.description,
      tag: args.tag as CopyImageTag | undefined,
      takenAt: args.takenAt === undefined ? undefined : new Date(args.takenAt),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
