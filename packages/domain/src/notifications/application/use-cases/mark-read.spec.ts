import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toNotificationId } from "../../../shared-kernel";
import { MemberId, Notification, NotificationId } from "../../domain";
import {
  FixedClock,
  InMemoryNotificationRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeMarkAllRead, MarkAllReadDeps } from "./mark-all-read";
import {
  makeMarkNotificationRead,
  MarkNotificationReadDeps,
} from "./mark-notification-read";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const NOW = new Date("2026-06-08T10:00:00Z");

let notifications: InMemoryNotificationRepository;
let events: RecordingEventPublisher;

beforeEach(() => {
  notifications = new InMemoryNotificationRepository();
  events = new RecordingEventPublisher();
});

const seed = async (id: string, owner: MemberId): Promise<NotificationId> => {
  const nid = toNotificationId(id);
  const n = Notification.create({
    id: nid,
    userId: owner,
    type: "trade_request",
    title: "t",
    message: "m",
    channel: "inApp",
    now: NOW,
  });
  n.pullEvents();
  await notifications.save(n);
  return nid;
};

describe("makeMarkNotificationRead", () => {
  const deps = (): MarkNotificationReadDeps => ({
    notifications,
    events,
    clock: new FixedClock(NOW),
  });

  it("marks the owner's notification read and publishes NotificationRead", async () => {
    const id = await seed("n1", alice);
    const markRead = makeMarkNotificationRead(deps());
    const result = await markRead({ memberId: alice, notificationId: id });

    expect(result.isOk).toBe(true);
    const stored = await notifications.findById(id);
    expect(stored?.isRead).toBe(true);
    expect(events.names()).toEqual(["NotificationRead"]);
  });

  it("returns NotificationNotFound for an unknown id", async () => {
    const markRead = makeMarkNotificationRead(deps());
    const result = await markRead({
      memberId: alice,
      notificationId: toNotificationId("missing"),
    });

    expect(result.isOk).toBe(false);
    if (result.isErr) expect(result.error.code).toBe("NotificationNotFound");
    expect(events.published).toEqual([]);
  });

  it("rejects a non-owner with NotNotificationOwner and does not mutate", async () => {
    const id = await seed("n1", alice);
    const markRead = makeMarkNotificationRead(deps());
    const result = await markRead({ memberId: bob, notificationId: id });

    expect(result.isOk).toBe(false);
    if (result.isErr) expect(result.error.code).toBe("NotNotificationOwner");
    const stored = await notifications.findById(id);
    expect(stored?.isRead).toBe(false);
    expect(events.published).toEqual([]);
  });

  it("is idempotent: marking an already-read notification publishes nothing new", async () => {
    const id = await seed("n1", alice);
    const markRead = makeMarkNotificationRead(deps());
    await markRead({ memberId: alice, notificationId: id });
    events.published.length = 0;

    const second = await markRead({ memberId: alice, notificationId: id });
    expect(second.isOk).toBe(true);
    expect(events.published).toEqual([]);
  });
});

describe("makeMarkAllRead", () => {
  const deps = (): MarkAllReadDeps => ({
    notifications,
    events,
    clock: new FixedClock(NOW),
  });

  it("marks all of a member's unread notifications and returns the count", async () => {
    const a = await seed("a", alice);
    const b = await seed("b", alice);
    await seed("c", bob); // other member, must be untouched

    const markAll = makeMarkAllRead(deps());
    const result = await markAll({ memberId: alice });

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toBe(2);

    expect((await notifications.findById(a))?.isRead).toBe(true);
    expect((await notifications.findById(b))?.isRead).toBe(true);
    expect((await notifications.findById(toNotificationId("c")))?.isRead).toBe(
      false,
    );

    expect(events.names()).toEqual(["NotificationRead", "NotificationRead"]);
  });

  it("returns 0 and publishes nothing when there is nothing unread", async () => {
    const markAll = makeMarkAllRead(deps());
    const result = await markAll({ memberId: alice });
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toBe(0);
    expect(events.published).toEqual([]);
    expect(events.batches).toEqual([]); // never calls publish at all when nothing is pending
  });
});
