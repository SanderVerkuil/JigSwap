import type { HouseholdDeps } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { convexHouseholdInviteRepository } from "./convexHouseholdInviteRepository";
import { convexHouseholdJoinRequestRepository } from "./convexHouseholdJoinRequestRepository";
import { convexHouseholdRepository } from "./convexHouseholdRepository";
import {
  householdEventPublisher,
  householdIdGenerator,
  householdInviteIdGenerator,
  householdJoinRequestIdGenerator,
  systemClock,
} from "./runtime";

// The full dependency bag for the household use cases, built per mutation.
export const householdDeps = (ctx: MutationCtx): HouseholdDeps => ({
  households: convexHouseholdRepository(ctx),
  invites: convexHouseholdInviteRepository(ctx),
  householdIds: householdIdGenerator,
  inviteIds: householdInviteIdGenerator,
  joinRequests: convexHouseholdJoinRequestRepository(ctx),
  joinRequestIds: householdJoinRequestIdGenerator,
  events: householdEventPublisher(ctx),
  clock: systemClock,
});
