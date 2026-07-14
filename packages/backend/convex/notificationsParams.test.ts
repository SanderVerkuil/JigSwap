import { Notification, toMemberId, toNotificationId } from "@jigswap/domain";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import { toDomain, toRow } from "./notifications/adapters/notificationMapper";

const NOW = new Date("2026-07-13T10:00:00Z");

describe("notificationMapper params", () => {
  it("round-trips params through toRow/toDomain", () => {
    const notification = Notification.create({
      id: toNotificationId("n-1"),
      userId: toMemberId("user-1"),
      type: "trade_request",
      params: { actorName: "Bob" },
      relatedId: "exchange-1",
      channel: "inApp",
      now: NOW,
    });
    const row = toRow(notification);
    expect(row.params).toEqual({ actorName: "Bob" });
    expect(row.title).toBeUndefined();

    const doc = {
      ...row,
      _id: "doc-1" as Id<"notifications">,
      _creationTime: NOW.getTime(),
    } as Doc<"notifications">;
    expect(toDomain(doc).toState().params).toEqual({ actorName: "Bob" });
  });

  it("rehydrates a legacy row (title/message strings, no params)", () => {
    const doc = {
      _id: "doc-2" as Id<"notifications">,
      _creationTime: NOW.getTime(),
      aggregateId: "n-2",
      userId: "user-1" as Id<"users">,
      type: "trade_request",
      title: "New Exchange Request",
      message: "Someone wants to trade for one of your puzzles",
      channel: "inApp",
      isRead: false,
      createdAt: NOW.getTime(),
    } as Doc<"notifications">;
    const state = toDomain(doc).toState();
    expect(state.title).toBe("New Exchange Request");
    expect(state.params).toBeUndefined();
  });
});
