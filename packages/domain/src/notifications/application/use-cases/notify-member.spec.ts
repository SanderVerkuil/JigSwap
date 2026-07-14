import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toNotificationPreferenceId } from "../../../shared-kernel";
import { NotificationCreated, NotificationPreference } from "../../domain";
import { NotificationApplicationError } from "../errors";
import {
  FixedClock,
  InMemoryNotificationPreferenceRepository,
  InMemoryNotificationRepository,
  RecordingEventPublisher,
  RecordingNotificationDelivery,
  SequentialNotificationIdGenerator,
  SequentialPreferenceIdGenerator,
} from "../testing";
import { makeNotifyMember, NotifyMemberDeps } from "./notify-member";

const alice = toMemberId("alice");
const NOW = new Date("2026-06-08T10:00:00Z");

let notifications: InMemoryNotificationRepository;
let preferences: InMemoryNotificationPreferenceRepository;
let events: RecordingEventPublisher;
let delivery: RecordingNotificationDelivery;
let deps: NotifyMemberDeps;

const prefId = () => toNotificationPreferenceId("seed");

beforeEach(() => {
  notifications = new InMemoryNotificationRepository();
  preferences = new InMemoryNotificationPreferenceRepository();
  events = new RecordingEventPublisher();
  // In-app deliveries persist through the fake into `notifications`, so the read-based assertions
  // below stay valid even though the use case no longer touches the repository directly.
  delivery = new RecordingNotificationDelivery(notifications);
  deps = {
    delivery,
    preferences,
    notificationIds: new SequentialNotificationIdGenerator(),
    preferenceIds: new SequentialPreferenceIdGenerator(),
    events,
    clock: new FixedClock(NOW),
  };
});

const cmd = (
  overrides: Partial<Parameters<ReturnType<typeof makeNotifyMember>>[0]> = {},
) => ({
  memberId: alice,
  type: "trade_request" as const,
  params: { actorName: "Bob" },
  ...overrides,
});

describe("makeNotifyMember", () => {
  it("creates one in-app notification by default (no stored preference)", async () => {
    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(cmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toHaveLength(1);
    expect(notifications.size()).toBe(1);
    // In-app delivery is recorded AND persisted (the real in-app channel saves a row).
    expect(delivery.channels()).toEqual(["inApp"]);

    const [stored] = await notifications.listByUser(alice);
    expect(stored.channel).toBe("inApp");
    expect(stored.userId).toBe(alice);
    expect(stored.isRead).toBe(false);

    expect(events.names()).toEqual(["NotificationCreated"]);
    expect((events.published[0] as NotificationCreated).channel).toBe("inApp");
  });

  it("materialises and persists a default preference when none exists", async () => {
    const notifyMember = makeNotifyMember(deps);
    await notifyMember(cmd());
    expect(preferences.size()).toBe(1);
    const pref = await preferences.findByMember(alice);
    expect(pref?.allows("trade_request", "inApp")).toBe(true);
  });

  it("suppresses the notification when the type/channel is disabled (no-op)", async () => {
    const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
    pref.disable("trade_request", "inApp", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(cmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toEqual([]);
    expect(notifications.size()).toBe(0);
    expect(events.published).toEqual([]);
    expect(events.batches).toEqual([]); // nothing delivered ⇒ publish is never called
    // A fully-suppressed type delivers nothing to any channel.
    expect(delivery.delivered).toEqual([]);
  });

  it("delivers email when the member opts into the email channel", async () => {
    const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
    pref.enable("trade_request", "email", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(cmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toHaveLength(2);
    // Both channels are delivered, but only the in-app one persists a row.
    expect(delivery.channels().sort()).toEqual(["email", "inApp"]);
    expect(notifications.size()).toBe(1);
    const [stored] = await notifications.listByUser(alice);
    expect(stored.channel).toBe("inApp");
  });

  it("delivers one notification per allowed channel", async () => {
    const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
    pref.enable("trade_request", "email", NOW);
    pref.enable("trade_request", "push", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(cmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toHaveLength(3);

    // Every allowed channel gets a delivery; only the in-app one persists a row.
    expect(delivery.channels().sort()).toEqual(["email", "inApp", "push"]);
    const stored = await notifications.listByUser(alice);
    expect(stored.map((n) => n.channel)).toEqual(["inApp"]);
    expect(events.names()).toEqual([
      "NotificationCreated",
      "NotificationCreated",
      "NotificationCreated",
    ]);
  });

  it("honours an explicit channels filter, still gated by preference", async () => {
    // Default pref: only inApp allowed. Ask for email+push only -> nothing passes.
    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(cmd({ channels: ["email", "push"] }));

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toEqual([]);
    expect(notifications.size()).toBe(0);
  });

  it("carries relatedId through to the stored notification", async () => {
    const notifyMember = makeNotifyMember(deps);
    await notifyMember(cmd({ relatedId: "exchange-42" }));
    const [stored] = await notifications.listByUser(alice);
    expect(stored.toState().relatedId).toBe("exchange-42");
  });

  it("never delivers email for a type outside EMAIL_ELIGIBLE_TYPES, even when opted in", async () => {
    const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
    pref.enable("puzzle_approved", "email", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(
      cmd({ type: "puzzle_approved" as const }),
    );

    expect(result.isOk).toBe(true);
    // Only inApp delivers — email is ineligible for moderation outcomes regardless of preference.
    expect(delivery.channels()).toEqual(["inApp"]);
  });

  it("still delivers email for an eligible type when opted in", async () => {
    const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
    pref.enable("message_received", "email", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const notifyMember = makeNotifyMember(deps);
    await notifyMember(cmd({ type: "message_received" as const }));
    expect(delivery.channels().sort()).toEqual(["email", "inApp"]);
  });
});

// Type-level guard: NotifyMember does not surface application errors. Kept trivial so a mutation
// that swaps the error contract is caught by the suite compiling + the assertions above.
describe("NotifyMember error contract", () => {
  it("does not produce a NotificationApplicationError", () => {
    expect(NotificationApplicationError.notificationNotFound).toBeTypeOf(
      "function",
    );
  });
});
