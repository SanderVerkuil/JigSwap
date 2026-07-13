import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "./notification-type";

describe("NOTIFICATION_TYPES", () => {
  it("is the canonical, ordered set of notification type literals", () => {
    expect(NOTIFICATION_TYPES).toEqual([
      "trade_request",
      "trade_accepted",
      "trade_declined",
      "trade_completed",
      "trade_cancelled",
      "message_received",
      "review_received",
      "puzzle_favorited",
      "goal_achieved",
      "puzzle_approved",
      "puzzle_rejected",
      "photo_removed",
      "exchange_proposed",
      "exchange_disputed",
      "proposal_approved",
      "proposal_rejected",
      "admin_proposal_filed",
      "admin_definition_submitted",
      "new_follower",
      "follow_request_received",
      "follow_request_approved",
    ]);
  });
});
