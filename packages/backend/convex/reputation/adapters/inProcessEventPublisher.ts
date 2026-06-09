import type { DomainEventPublisher } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. Reputation has
// no CRITICAL in-transaction reaction (submitPartnerReview already folds the review into the
// profile in the same transaction), so there are NO sync handlers — it only durably records +
// schedules its events (PartnerReviewSubmitted/ReputationChanged) for the async subscribers
// (Notifications maps PartnerReviewSubmitted -> the reviewee's "review_received").
export const inProcessEventPublisher = (ctx: MutationCtx): DomainEventPublisher =>
  makeEventPublisher(ctx, "reputation");
