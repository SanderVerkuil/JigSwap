import type { DomainEvent } from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`.
//
// WHY no-op in this slice: the only in-process reaction to PartnerReviewSubmitted would be to
// recompute the reviewee's ReputationProfile, but the submit use case ALREADY folds the review
// into the profile and saves it within the same transaction — there is no derived projection
// left to update here. The downstream consumers of PartnerReviewSubmitted/ReputationChanged
// (Notifications, Insights) are later phases with no live subscriber yet. Durable/async fan-out
// (an events table + scheduler dispatch) is a deliberate later enhancement; until then publish
// is a sink that preserves the port seam without doing cross-context work.
// `ctx` is accepted to match the other contexts' per-mutation factory shape.
export const inProcessEventPublisher = (
  _ctx: MutationCtx,
): { publish(events: readonly DomainEvent[]): Promise<void> } => ({
  async publish(_events: readonly DomainEvent[]): Promise<void> {
    // Intentionally empty: see module comment.
  },
});
