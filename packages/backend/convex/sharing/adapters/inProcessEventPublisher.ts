import {
  makeWithdrawInvitesFrom,
  MAX_CIRCLE_MEMBERS,
  type CircleId,
  type DomainEventPublisher,
  type MemberId,
  type SharingDomainEvent,
} from "@jigswap/domain";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";
import { deleteCircleSharesOfCopy } from "./circleCopyShares";
import { convexCircleInviteRepository } from "./convexCircleInviteRepository";
import { systemClock } from "./systemClock";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. It durably
// records + schedules ALL sharing events (for async subscribers like Notifications) while KEEPING
// the CRITICAL projections inline, in the SAME transaction: CopySharedToCircle materialises the
// circle-copy link so a freshly shared copy is immediately discoverable to circle members, and
// MemberLeftCircle withdraws the departed member's own links so their copies stop being reachable
// through the circle the moment they are out of it, and withdraws the invites they still had
// pending there (see withdrawInvitesFrom). CircleDeleted deletes the circle's pending invites inline
// and schedules the batched purge of what can be large (purgeDeletedCircle). CircleInviteIssued
// schedules the invite's expiry at its expiresAt (expiry is also applied lazily on every read and
// transition).
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
        await withdrawInvitesFrom(ctx, event.circleId, event.memberId);
      } else if (event.name === "CircleDeleted") {
        await deletePendingInvites(ctx, event.circleId as string);
        await ctx.scheduler.runAfter(
          0,
          internal.sharing.purgeDeletedCircle.purgeDeletedCircle,
          { circleId: event.circleId as string },
        );
      } else if (event.name === "CircleInviteIssued") {
        await ctx.scheduler.runAt(
          event.expiresAt,
          internal.sharing.expireCircleInvite.expireCircleInvite,
          { inviteId: event.inviteId as string },
        );
      }
    }
  });

/**
 * Withdraw the pending invites `inviterId` sent to the circle, in the caller's transaction. Runs
 * when they leave or are removed (MemberLeftCircle, above) and when they lose Admin
 * (sharing/changePermission), so nobody can join on an ex-inviter's word and the seats free up.
 */
export const withdrawInvitesFrom = (
  ctx: MutationCtx,
  circleId: CircleId,
  inviterId: MemberId,
): Promise<number> =>
  makeWithdrawInvitesFrom({
    invites: convexCircleInviteRepository(ctx),
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  })({ circleId, inviterId });

// Delete a deleted circle's PENDING invites in the deleting transaction. Pending invites hold seats
// against the member cap, so there are at most MAX_CIRCLE_MEMBERS of them (the take() bounds the
// write even if stale ones linger). Decided invites pile up over a circle's life, so they, and any
// pending one past the bound, go in purgeDeletedCircle's batches instead. Either way they grant
// nothing once the circle is gone. Pending invitees are not told: their invite stops being listed.
const deletePendingInvites = async (
  ctx: MutationCtx,
  circleId: string,
): Promise<void> => {
  const invites = await ctx.db
    .query("circleInvites")
    .withIndex("by_circle_status", (q) =>
      q.eq("circleAggregateId", circleId).eq("status", "pending"),
    )
    .take(MAX_CIRCLE_MEMBERS);
  for (const invite of invites) await ctx.db.delete(invite._id);
};

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
