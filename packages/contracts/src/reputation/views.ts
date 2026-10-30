// Reputation read-model view DTOs: typed shapes the gateway's `reputation.*` reads return, so the
// UI never receives raw `reviews` rows.

import type { ProjectedMember } from "../social/social";

/**
 * One review a member RECEIVED (`reputation.reviewsForMember`), newest first. An explicit shape on
 * purpose (SEC-12): it never carries the exchange, the reviewee or the stored row ids, because the
 * same exchange id under two members' lists would join them into the trade graph and name an
 * anonymous reviewer. `id` is opaque and identifies this review only. The reviewer is
 * privacy-projected per review. `comment` is absent when the reviewer left none, and also when the
 * reviewee's profile is private and the viewer is neither the reviewee nor a mutual follower; the
 * ratings always show, as the profile does. The list is empty when the reviewee blocked the viewer.
 */
export interface ReceivedReviewView {
  id: string;
  rating: number;
  categories: {
    communication: number;
    packaging: number;
    condition: number;
    timeliness: number;
  };
  comment?: string;
  createdAt: number;
  reviewer: ProjectedMember;
}
