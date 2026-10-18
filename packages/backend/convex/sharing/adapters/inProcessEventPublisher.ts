import type { DomainEventPublisher, SharingDomainEvent } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";
import { deleteCircleSharesOfCopy } from "./circleCopyShares";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. It durably
// records + schedules ALL sharing events (for async subscribers like Notifications) while KEEPING
// the CRITICAL projections inline, in the SAME transaction: CopySharedToCircle materialises the
// circle-copy link so a freshly shared copy is immediately discoverable to circle members, and
// MemberLeftCircle withdraws the departed member's own links so their copies stop being reachable
// through the circle the moment they are out of it.
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
      } else if (event.name === "MemberLeftCircle") {
        await withdrawMemberShares(
          ctx,
          event.circleId as string,
          event.memberId as unknown as Id<"users">,
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

// Drop the `circleCopyShares` links in this circle whose copy the departed member owns. Without
// this, an OPEN copy stays reachable to the remaining members through the stale link (the
// circle-aware policy passes any open copy, so it never checks the owner is still a member).
// Works from the member's own library (one point probe per copy) rather than scanning the
// circle's shares, so the cost scales with what the member owns, not with the whole circle.
const withdrawMemberShares = async (
  ctx: MutationCtx,
  circleId: string,
  memberId: Id<"users">,
): Promise<void> => {
  const copies = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
    .collect();
  for (const copy of copies) {
    const copyId = copy.aggregateId;
    if (!copyId) continue; // legacy rows without an aggregate id can't have been shared
    await deleteCircleSharesOfCopy(ctx, copyId, circleId);
  }
};
