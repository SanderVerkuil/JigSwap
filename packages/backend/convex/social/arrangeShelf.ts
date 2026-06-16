import { makeArrangeShelf, MAX_FEATURED, Profile } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexProfileRepository } from "./adapters/convexProfileRepository";
import { profileIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for arranging a profile's shelf: authenticate -> verify ownership of all
// supplied copies -> wire adapters -> call the use case. The member is derived from auth.
// WHY the create branch (mirrors setProfileVisibility): first-time curators who haven't edited
// their profile yet still need a profile row to store featuredCopyIds on.
export const arrangeShelf = mutation({
  args: {
    copyIds: v.array(v.id("ownedPuzzles")),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    // Transport-layer guard: the domain caps to MAX_FEATURED anyway, but reject an oversized
    // payload up front so a malformed client can't force a long ownership-check read loop.
    if (args.copyIds.length > MAX_FEATURED) {
      throw new ConvexError({
        code: "TooManyCopyIds",
        message: `At most ${MAX_FEATURED} copies can be featured`,
      });
    }

    // Ownership check: every supplied copy must be owned by the calling member. Reject if any
    // copy is owned by a different user or no longer exists (server-side enforcement).
    for (const copyId of args.copyIds) {
      const copy = await ctx.db.get(copyId);
      if (!copy) {
        throw new ConvexError({
          code: "CopyNotFound",
          message: `Copy ${copyId} not found`,
        });
      }
      if (copy.ownerId !== (memberId as unknown as Id<"users">)) {
        throw new ConvexError({
          code: "NotCopyOwner",
          message: `Copy ${copyId} is not owned by the calling member`,
        });
      }
    }

    const profiles = convexProfileRepository(ctx);
    const events = inProcessEventPublisher(ctx);
    const clock = systemClock;

    // Create-on-first-use: mirror setProfileVisibility so curating a shelf before any profile
    // edit still works.
    const existing = await profiles.findByMember(memberId);
    if (!existing) {
      const account = await ctx.db.get(memberId as unknown as Id<"users">);
      const displayName = account?.name?.trim() || "Member";
      const created = Profile.create(profileIdGenerator.next(), memberId, {
        displayName,
        now: clock.now(),
      });
      if (created.isErr) throw toConvexError(created.error);
      created.value.arrangeShelf(
        args.copyIds as unknown as string[],
        clock.now(),
      );
      await profiles.save(created.value);
      await events.publish(created.value.pullEvents());
      return;
    }

    const arrangeShelfUseCase = makeArrangeShelf({
      profiles,
      events,
      clock,
    });
    const result = await arrangeShelfUseCase({
      memberId,
      copyIds: args.copyIds as unknown as string[],
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
