import { describe, expect, it } from "vitest";
import { DomainEvent, toMemberId, toNotificationId } from "../../shared-kernel";
import { NotificationCreated, NotificationRead } from "./events";

import { Notification } from "./notification";

const id = toNotificationId("ntf1");
const alice = toMemberId("alice");
const bob = toMemberId("bob");
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

const create = (): Notification =>
  Notification.create({
    id,
    userId: alice,
    type: "trade_request",
    relatedId: "exchange-7",
    channel: "inApp",
    now: NOW,
  });

describe("Notification.create", () => {
  it("creates an unread notification and records NotificationCreated", () => {
    const n = create();
    expect(n.isRead).toBe(false);
    expect(n.userId).toBe(alice);
    expect(n.channel).toBe("inApp");
    expect(names(n.pullEvents())).toEqual(["NotificationCreated"]);
  });

  it("records the channel and type on the created event", () => {
    const n = create();
    const [event] = n.pullEvents();
    expect(event).toBeInstanceOf(NotificationCreated);
    const created = event as NotificationCreated;
    expect(created.channel).toBe("inApp");
    expect(created.type).toBe("trade_request");
    expect(created.userId).toBe(alice);
    expect(created.occurredAt).toBe(NOW);
  });

  it("round-trips through toState/rehydrate preserving all columns", () => {
    const n = create();
    n.pullEvents();
    const state = n.toState();
    expect(state).toEqual({
      id,
      userId: alice,
      type: "trade_request",
      relatedId: "exchange-7",
      channel: "inApp",
      isRead: false,
      createdAt: NOW,
    });
    const back = Notification.rehydrate(state);
    expect(back.toState()).toEqual(state);
    // rehydrate must not re-emit creation events.
    expect(back.pullEvents()).toEqual([]);
  });

  it("rehydrates legacy state carrying pre-rendered title/message", () => {
    // Legacy rows persisted before params existed; rehydrate must still round-trip them intact,
    // even though Notification.create() never produces title/message itself anymore.
    const legacyState = {
      id,
      userId: alice,
      type: "trade_request" as const,
      title: "New trade request",
      message: "Bob wants your puzzle",
      relatedId: "exchange-7",
      channel: "inApp" as const,
      isRead: false,
      createdAt: NOW,
    };
    const n = Notification.rehydrate(legacyState);
    expect(n.toState()).toEqual(legacyState);
    expect(n.pullEvents()).toEqual([]);
  });

  it("carries params through create/toState/rehydrate", () => {
    const notification = Notification.create({
      id: toNotificationId("n-1"),
      userId: toMemberId("alice"),
      type: "trade_request",
      params: { actorName: "Bob" },
      channel: "inApp",
      now: new Date("2026-06-08T10:00:00Z"),
    });
    expect(notification.toState().params).toEqual({ actorName: "Bob" });
    const rehydrated = Notification.rehydrate(notification.toState());
    expect(rehydrated.toState().params).toEqual({ actorName: "Bob" });
  });
});

describe("Notification.markRead", () => {
  it("marks read and records NotificationRead for the owner", () => {
    const n = create();
    n.pullEvents();
    const result = n.markRead(alice, LATER);
    expect(result.isOk).toBe(true);
    expect(n.isRead).toBe(true);
    const events = n.pullEvents();
    expect(names(events)).toEqual(["NotificationRead"]);
    expect((events[0] as NotificationRead).occurredAt).toBe(LATER);
  });

  it("is idempotent: a second markRead is a no-op that records nothing", () => {
    const n = create();
    n.pullEvents();
    expect(n.markRead(alice, LATER).isOk).toBe(true);
    n.pullEvents();
    const second = n.markRead(alice, LATER);
    expect(second.isOk).toBe(true);
    expect(n.isRead).toBe(true);
    expect(n.pullEvents()).toEqual([]);
  });

  it("rejects a non-owner with NotNotificationOwner and does not mutate", () => {
    const n = create();
    n.pullEvents();
    const result = n.markRead(bob, LATER);
    expect(result.isOk).toBe(false);
    if (result.isErr) {
      expect(result.error.code).toBe("NotNotificationOwner");
    }
    expect(n.isRead).toBe(false);
    expect(n.pullEvents()).toEqual([]);
  });
});
