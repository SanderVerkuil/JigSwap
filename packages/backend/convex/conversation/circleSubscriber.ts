import {
  makeSyncCircleParticipant,
  toCircleId,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { convexCircleRoster } from "./adapters/circleRoster";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { toConvexError } from "./errors";
import { participantRowOf } from "./readModelHelpers";
import { clearTypingOf } from "./typingIndicators";

// The circle events this subscriber reacts to (events/dispatch registers it for exactly these).
export const CIRCLE_MEMBERSHIP_EVENTS = [
  "MemberJoinedCircle",
  "MemberLeftCircle",
] as const;

// Mirrors circle membership into the circle's thread: a member with a seat is a participant whose
// floor is the seat's join time, posted as a "joined" row; a member without one (left, removed, or
// whose account is gone) is not, posted as a "left" row, and their participant and typing rows
// go. No thread yet: nothing to do (it is created lazily, seeded from the roster).
//
// Convergent: whichever event arrives, the thread is brought to what the circle says NOW, so a
// retry, a replay, or events run late or out of order all end in the same state. A participant
// row older than the current seat (a leave and re-join whose "left" was skipped or ran late) is
// refreshed: a "left" row, then a fresh "joined" row and floor.
export const handleCircleMembershipEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  if (event.name !== "MemberJoinedCircle" && event.name !== "MemberLeftCircle")
    return;
  const p = event.payload as Record<string, unknown>;
  const circleId = toCircleId(p.circleId as string);
  const memberId = toMemberId(p.memberId as string);

  const roster = await convexCircleRoster(ctx).membersOf(circleId);
  if (!roster) return; // the circle is gone; purgeDeletedCircle removes its thread
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_circle", (q) => q.eq("circleId", circleId as string))
    .first();
  if (!thread) return;
  const participant = await participantRowOf(
    ctx,
    thread.aggregateId,
    p.memberId as Id<"users">,
  );
  const seat = roster.find((m) => m.memberId === memberId);

  const sync = makeSyncCircleParticipant({
    threads: convexThreadRepository(ctx),
    messageIds: messageIdGenerator,
    events: inProcessEventPublisher(ctx),
  });
  const apply = async (change: "joined" | "left", at: Date) => {
    const result = await sync({ circleId, memberId, change, at });
    if (result.isErr) throw toConvexError(result.error);
  };
  const leftAt = new Date(
    event.name === "MemberLeftCircle" ? event.occurredAt : Date.now(),
  );

  if (!seat) {
    if (participant) await apply("left", leftAt);
    await clearTypingOf(ctx, thread.aggregateId, p.memberId as Id<"users">);
    return;
  }
  const seatJoinedAt = seat.joinedAt.getTime();
  if (
    participant?.joinedAt !== undefined &&
    participant.joinedAt >= seatJoinedAt
  )
    return; // already current
  if (participant) {
    // A stale row from an earlier membership: close it before the seat's join time.
    await apply(
      "left",
      new Date(
        event.name === "MemberLeftCircle" && event.occurredAt < seatJoinedAt
          ? event.occurredAt
          : seatJoinedAt - 1,
      ),
    );
  }
  // A join's floor is the seat's join time (exactly what a lazily created thread would seed); the
  // "joined" row is sent at that instant, so only the joiner's own read exempts it.
  await apply("joined", seat.joinedAt);
};
