import type { DomainEventPublisher, SharingDomainEvent } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. It durably
// records + schedules ALL sharing events (for async subscribers like Notifications) while KEEPING
// the one CRITICAL projection inline: CopySharedToCircle must materialise the circle-copy link in
// the SAME transaction so a freshly shared copy is immediately discoverable to circle members.
export const inProcessEventPublisher = (
  ctx: MutationCtx,
): DomainEventPublisher =>
  makeEventPublisher(ctx, "sharing", async (events) => {
    for (const event of events as readonly SharingDomainEvent[]) {
      if (event.name === "CopySharedToCircle") {
        await projectCopyShare(
          ctx,
          event.circleId as string,
          event.copyId as string,
          event.occurredAt.getTime(),
        );
      }
    }
  });

// Idempotent projection of a CopySharedToCircle event into the `circleCopyShares` read model.
const projectCopyShare = async (
  ctx: MutationCtx,
  circleId: string,
  copyId: string,
  sharedAt: number,
): Promise<void> => {
  const existing = await ctx.db
    .query("circleCopyShares")
    .withIndex("by_circle_copy", (q) =>
      q.eq("circleId", circleId).eq("copyId", copyId),
    )
    .unique();
  if (existing) return;
  await ctx.db.insert("circleCopyShares", { circleId, copyId, sharedAt });
};
