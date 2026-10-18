import type { CircleInviteDeps } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { convexCircleInviteRepository } from "./convexCircleInviteRepository";
import { convexCircleRepository } from "./convexCircleRepository";
import { convexInvitePolicy } from "./convexInvitePolicy";
import { circleInviteIdGenerator, membershipIdGenerator } from "./idGenerators";
import { inProcessEventPublisher } from "./inProcessEventPublisher";
import { systemClock } from "./systemClock";

// The full dependency bag for the circle-invite use cases, built per mutation.
export const circleInviteDeps = (ctx: MutationCtx): CircleInviteDeps => ({
  circles: convexCircleRepository(ctx),
  invites: convexCircleInviteRepository(ctx),
  policy: convexInvitePolicy(ctx),
  inviteIds: circleInviteIdGenerator,
  membershipIds: membershipIdGenerator,
  events: inProcessEventPublisher(ctx),
  clock: systemClock,
});
