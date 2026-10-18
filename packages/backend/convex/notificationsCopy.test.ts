import { NOTIFICATION_TYPES } from "@jigswap/domain";
import { describe, expect, it } from "vitest";
import { pushTextOf, renderNotificationText } from "./notifications/copy";

describe("renderNotificationText", () => {
  it("covers every notification type with a non-empty title and message", () => {
    for (const type of NOTIFICATION_TYPES) {
      const { title, message } = renderNotificationText(type, {});
      expect(title.length, type).toBeGreaterThan(0);
      expect(message.length, type).toBeGreaterThan(0);
    }
  });

  it("interpolates params", () => {
    expect(
      renderNotificationText("goal_achieved", { goalTitle: "100 puzzles" })
        .message,
    ).toBe('You reached your goal "100 puzzles"!');
    expect(
      renderNotificationText("trade_request", { actorName: "Bob" }).message,
    ).toBe("Bob wants to trade for one of your puzzles");
    expect(
      renderNotificationText("proposal_rejected", {
        puzzleTitle: "Sky",
        reason: "duplicate",
      }).message,
    ).toBe('Your suggested edit to "Sky" was declined: duplicate');
  });

  it("falls back gracefully when params are missing", () => {
    expect(renderNotificationText("trade_request", {}).message).toBe(
      "Someone wants to trade for one of your puzzles",
    );
    expect(renderNotificationText("proposal_rejected", {}).message).toBe(
      "Your suggested edit was declined",
    );
  });

  it("asks to follow each other on a connection offer, named or not", () => {
    expect(
      renderNotificationText("connection_offer_received", { actorName: "Bo" })
        .message,
    ).toBe("Bo invited you to JigSwap. Follow each other?");
    expect(
      renderNotificationText("connection_offer_received", {}).message,
    ).toBe("Someone invited you to JigSwap. Follow each other?");
  });
});

describe("renderNotificationText with resolved context", () => {
  it.each([
    [
      "trade_request",
      { actorName: "Bo", puzzleTitle: "Sky" },
      'Bo wants to trade for "Sky"',
    ],
    [
      "trade_request",
      { puzzleTitle: "Sky" },
      'Someone wants to trade for "Sky"',
    ],
    [
      "trade_accepted",
      { actorName: "Bo", puzzleTitle: "Sky" },
      'Bo accepted your trade request for "Sky"',
    ],
    ["trade_accepted", { actorName: "Bo" }, "Bo accepted your trade request"],
    [
      "trade_accepted",
      { puzzleTitle: "Sky" },
      "Your trade request has been accepted!",
    ],
    [
      "trade_declined",
      { actorName: "Bo", puzzleTitle: "Sky" },
      'Bo declined your trade request for "Sky"',
    ],
    ["trade_declined", {}, "Your trade request has been declined"],
    [
      "trade_completed",
      { actorName: "Bo", puzzleTitle: "Sky" },
      'Your exchange of "Sky" with Bo was marked as completed',
    ],
    [
      "trade_completed",
      { actorName: "Bo" },
      "Your exchange with Bo was marked as completed",
    ],
    ["trade_completed", {}, "Exchange has been marked as completed"],
    [
      "trade_cancelled",
      { actorName: "Bo", puzzleTitle: "Sky" },
      'Bo cancelled the trade request for "Sky"',
    ],
    ["trade_cancelled", {}, "Exchange request has been cancelled"],
    [
      "exchange_disputed",
      { actorName: "Bo", puzzleTitle: "Sky" },
      'Bo flagged an issue with your exchange of "Sky"',
    ],
    [
      "exchange_disputed",
      {},
      "The other party has flagged an issue with your exchange",
    ],
    [
      "review_received",
      { actorName: "Bo", rating: "5" },
      "Bo left you a 5-star review",
    ],
    ["review_received", { actorName: "Bo" }, "Bo left you a review"],
    ["review_received", { rating: "5" }, "You received a new partner review"],
    [
      "follow_request_approved",
      { actorName: "Bo" },
      "Bo approved your follow request",
    ],
    ["follow_request_approved", {}, "Your follow request was approved"],
  ] as const)("%s %j", (type, params, message) => {
    expect(renderNotificationText(type, params).message).toBe(message);
  });

  it("message_received titles the sender and shows the preview as the body", () => {
    expect(
      renderNotificationText("message_received", {
        actorName: "Bo",
        messagePreview: "See you Saturday",
      }),
    ).toEqual({ title: "New message from Bo", message: "See you Saturday" });
    expect(
      renderNotificationText("message_received", {
        messagePreview: "See you Saturday",
      }),
    ).toEqual({ title: "New message", message: "You have a new message" });
  });
});

describe("pushTextOf", () => {
  it("renders the resolved params", () => {
    expect(
      pushTextOf("new_follower", {
        params: { actorName: "Bo" },
        actorAnonymous: false,
        href: "/members/bo",
      }).message,
    ).toBe("Bo started following you");
  });

  it("labels an anonymous actor as a former member", () => {
    expect(
      pushTextOf("household_invite_accepted", {
        params: {},
        actorAnonymous: true,
        href: "/household",
      }).message,
    ).toBe("Former member joined your household");
  });
});
