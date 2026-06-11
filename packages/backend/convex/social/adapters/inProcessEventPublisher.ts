import type { DomainEventPublisher } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. Social has no
// critical in-transaction reaction to its own events, so it only durably records + schedules them
// (so decoupled subscribers like Notifications can react to MemberFollowed/ProfileUpdated).
export const inProcessEventPublisher = (
  ctx: MutationCtx,
): DomainEventPublisher => makeEventPublisher(ctx, "social");
