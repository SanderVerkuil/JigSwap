import { describe, expect, test } from "vitest";
import { buildTriggerPayload } from "./knock";

describe("buildTriggerPayload", () => {
  test("inlines the recipient and carries the channel in data", () => {
    const payload = buildTriggerPayload({
      channel: "email",
      type: "trade_request",
      title: "New Exchange Request",
      message: "Someone proposed an exchange.",
      relatedId: "exchange-123",
      recipient: { id: "user_abc", email: "a@b.test", name: "Anna" },
    });

    expect(payload).toEqual({
      recipients: [{ id: "user_abc", email: "a@b.test", name: "Anna" }],
      data: {
        channel: "email",
        type: "trade_request",
        title: "New Exchange Request",
        message: "Someone proposed an exchange.",
        relatedId: "exchange-123",
      },
    });
  });

  test("omitted relatedId stays undefined rather than leaking a value", () => {
    const payload = buildTriggerPayload({
      channel: "push",
      type: "goal_achieved",
      title: "Goal achieved",
      message: "You reached your goal.",
      recipient: { id: "user_abc", email: "a@b.test", name: "Anna" },
    });

    expect(payload.data.relatedId).toBeUndefined();
    expect(payload.data.channel).toBe("push");
  });
});
