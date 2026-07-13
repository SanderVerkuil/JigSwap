import { NOTIFICATION_TYPES } from "@jigswap/domain";
import { describe, expect, it } from "vitest";
import { renderNotificationText } from "./notifications/copy";

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
});
