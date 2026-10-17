import {
  type Clock,
  type DomainEventPublisher,
  type HouseholdId,
  type HouseholdIdGenerator,
  type HouseholdInviteId,
  type HouseholdInviteIdGenerator,
  toHouseholdId,
  toHouseholdInviteId,
} from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapters for the Household context's clock, id generators and event publisher. Household
// has no in-transaction reaction to its own events; they are only recorded + dispatched so the
// Notifications subscriber can turn invites into notifications.
export const systemClock: Clock = { now: () => new Date() };

export const householdIdGenerator: HouseholdIdGenerator = {
  next: (): HouseholdId => toHouseholdId(crypto.randomUUID()),
};

export const householdInviteIdGenerator: HouseholdInviteIdGenerator = {
  next: (): HouseholdInviteId => toHouseholdInviteId(crypto.randomUUID()),
};

export const householdEventPublisher = (
  ctx: MutationCtx,
): DomainEventPublisher => makeEventPublisher(ctx, "household");
