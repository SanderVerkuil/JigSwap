import { describe, expect, it } from "vitest";
import { EMAIL_ELIGIBLE_TYPES, NOTIFICATION_TYPES } from "./notification-type";

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

describe("EMAIL_ELIGIBLE_TYPES", () => {
  it("is exactly the high-value subset that may be delivered by email", () => {
    expect([...EMAIL_ELIGIBLE_TYPES].sort()).toEqual(
      [
        "trade_request",
        "trade_accepted",
        "trade_declined",
        "trade_completed",
        "trade_cancelled",
        "message_received",
        "review_received",
        "puzzle_favorited",
        "goal_achieved",
        "new_follower",
        "follow_request_received",
        "follow_request_approved",
      ].sort(),
    );
  });

  it("only contains canonical notification types", () => {
    for (const type of EMAIL_ELIGIBLE_TYPES) {
      expect(NOTIFICATION_TYPES).toContain(type);
    }
  });
});
