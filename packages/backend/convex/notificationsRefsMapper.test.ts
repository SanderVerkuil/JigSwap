import { Notification, toMemberId, toNotificationId } from "@jigswap/domain";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import { toDomain, toRow } from "./notifications/adapters/notificationMapper";

const NOW = new Date("2026-07-13T10:00:00Z");

const asDoc = (row: ReturnType<typeof toRow>): Doc<"notifications"> =>
  ({
    ...row,
    _id: "doc-1" as Id<"notifications">,
    _creationTime: NOW.getTime(),
  }) as Doc<"notifications">;

describe("notificationMapper actor/subject refs", () => {
  it("writes the actor as a one-element actorIds with actorCount 1, plus the subject", () => {
    const notification = Notification.create({
      id: toNotificationId("n-1"),
      userId: toMemberId("user-1"),
      type: "trade_request",
      relatedId: "exchange-doc-1",
      actorId: toMemberId("user-2"),
      subject: { kind: "exchange", exchangeId: "exchange-agg-1" },
      channel: "inApp",
      now: NOW,
    });
    const row = toRow(notification);
    expect(row.actorIds).toEqual(["user-2"]);
    expect(row.actorCount).toBe(1);
    expect(row.subject).toEqual({
      kind: "exchange",
      exchangeId: "exchange-agg-1",
    });

    const state = toDomain(asDoc(row)).toState();
    expect(state.actorId).toBe("user-2");
    expect(state.subject).toEqual({
      kind: "exchange",
      exchangeId: "exchange-agg-1",
    });
  });

  it("omits the ref keys entirely when the notification has no actor or subject", () => {
    const notification = Notification.create({
      id: toNotificationId("n-2"),
      userId: toMemberId("user-1"),
      type: "whats_new",
      channel: "inApp",
      now: NOW,
    });
    const row = toRow(notification);
    expect("actorIds" in row).toBe(false);
    expect("actorCount" in row).toBe(false);
    expect("subject" in row).toBe(false);
  });

  it("reads the newest actor of a grouped row", () => {
    const doc = {
      _id: "doc-3" as Id<"notifications">,
      _creationTime: NOW.getTime(),
      aggregateId: "n-3",
      userId: "user-1" as Id<"users">,
      type: "new_follower",
      actorIds: ["user-9", "user-8"] as Id<"users">[],
      actorCount: 5,
      channel: "inApp",
      isRead: false,
      createdAt: NOW.getTime(),
    } as Doc<"notifications">;
    expect(toDomain(doc).toState().actorId).toBe("user-9");
  });

  it("reads a legacy row without refs", () => {
    const doc = {
      _id: "doc-4" as Id<"notifications">,
      _creationTime: NOW.getTime(),
      aggregateId: "n-4",
      userId: "user-1" as Id<"users">,
      type: "new_follower",
      params: { actorName: "Mara" },
      relatedId: "user-2",
      isRead: true,
      createdAt: NOW.getTime(),
    } as Doc<"notifications">;
    const state = toDomain(doc).toState();
    expect(state.actorId).toBeUndefined();
    expect(state.subject).toBeUndefined();
    expect(state.channel).toBe("inApp");
    expect(state.params).toEqual({ actorName: "Mara" });
    expect(state.isRead).toBe(true);
  });
});
