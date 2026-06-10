import { makeDeleteCopy, type OwnerId, toCopyId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { convexCopyReservationPort } from "./adapters/convexCopyReservationPort";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for deleting a copy. The reserved-copy guard (a copy referenced by an active
// exchange cannot be deleted) is enforced in the use case via the reservation port. `copyId` is
// the domain aggregateId; the repository cascades the membership/image cleanup.
export const deleteCopy = mutation({
  args: { copyId: v.string() },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const remove = makeDeleteCopy({
      copies: convexCopyRepository(ctx),
      reservations: convexCopyReservationPort(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await remove({
      actingMemberId,
      copyId: toCopyId(args.copyId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
