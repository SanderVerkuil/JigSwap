import {
  makeSyncCircleParticipant,
  toCircleId,
  toMemberId,
} from "@jigswap/domain";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { convexCircleRoster } from "./adapters/circleRoster";
import { convexThreadRepository } from "./adapters/convexThreadRepository";
import { messageIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { toConvexError } from "./errors";

// The circle events this subscriber reacts to (events/dispatch registers it for exactly these).
export const CIRCLE_MEMBERSHIP_EVENTS = [
  "MemberJoinedCircle",
  "MemberLeftCircle",
] as const;

// Mirrors circle membership into the circle's thread: on MemberJoinedCircle the member becomes a
// participant (history floor = their circle join time) and a "joined" row is posted; on
// MemberLeftCircle (leaving and an Admin's removal alike) they stop being one, their participant
// row goes, and a "left" row is posted. No thread yet: nothing to do (it is created lazily,
// seeded from the roster).
//
// Convergent, so it is safe to retry and to run late or out of order: the change is applied only
// while it is still TRUE of the circle now. A "joined" for someone who has since left, or a
// "left" for someone who has since re-joined, is a no-op (the later event brings the thread to the
// same state), and the use case itself does nothing when the set already matches.
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
  const seat = roster.find((m) => m.memberId === memberId);
  const change = event.name === "MemberJoinedCircle" ? "joined" : "left";
  if ((change === "joined") !== (seat !== undefined)) return; // stale: superseded since

  const sync = makeSyncCircleParticipant({
    threads: convexThreadRepository(ctx),
    messageIds: messageIdGenerator,
    events: inProcessEventPublisher(ctx),
  });
  const result = await sync({
    circleId,
    memberId,
    change,
    // A join's floor is the seat's join time (exactly what a lazily created thread would seed);
    // the "joined" row is sent at that instant, so it sits at the floor and only the joiner's own
    // read exempts it.
    at: seat?.joinedAt ?? new Date(event.occurredAt),
  });
  if (result.isErr) throw toConvexError(result.error);
};
