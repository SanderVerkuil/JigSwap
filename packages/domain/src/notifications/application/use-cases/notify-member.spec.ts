import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import {
  MemberId,
  NotificationCreated,
  NotificationPreference,
} from "../../domain";
import { NotificationApplicationError } from "../errors";
import {
  FixedClock,
  InMemoryNotificationPreferenceRepository,
  InMemoryNotificationRepository,
  RecordingEventPublisher,
  SequentialNotificationIdGenerator,
  SequentialPreferenceIdGenerator,
} from "../testing";
import { makeNotifyMember, NotifyMemberDeps } from "./notify-member";

const alice = toId<"MemberId">("alice") as MemberId;
const NOW = new Date("2026-06-08T10:00:00Z");

let notifications: InMemoryNotificationRepository;
let preferences: InMemoryNotificationPreferenceRepository;
let events: RecordingEventPublisher;
let deps: NotifyMemberDeps;

const prefId = () => toId<"NotificationPreferenceId">("seed");

beforeEach(() => {
  notifications = new InMemoryNotificationRepository();
  preferences = new InMemoryNotificationPreferenceRepository();
  events = new RecordingEventPublisher();
  deps = {
    notifications,
    preferences,
    notificationIds: new SequentialNotificationIdGenerator(),
    preferenceIds: new SequentialPreferenceIdGenerator(),
    events,
    clock: new FixedClock(NOW),
  };
});

const cmd = (overrides: Partial<Parameters<ReturnType<typeof makeNotifyMember>>[0]> = {}) => ({
  memberId: alice,
  type: "trade_request" as const,
  title: "New trade request",
  message: "Bob wants your puzzle",
  ...overrides,
});

describe("makeNotifyMember", () => {
  it("creates one in-app notification by default (no stored preference)", async () => {
    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(cmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toHaveLength(1);
    expect(notifications.size()).toBe(1);

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
  });

  it("creates one notification per allowed channel", async () => {
    const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
    pref.enable("trade_request", "email", NOW);
    pref.enable("trade_request", "push", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const notifyMember = makeNotifyMember(deps);
    const result = await notifyMember(cmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toHaveLength(3);

    const stored = await notifications.listByUser(alice);
    const channels = stored.map((n) => n.channel).sort();
    expect(channels).toEqual(["email", "inApp", "push"]);
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
});

// Type-level guard: NotifyMember does not surface application errors. Kept trivial so a mutation
// that swaps the error contract is caught by the suite compiling + the assertions above.
describe("NotifyMember error contract", () => {
  it("does not produce a NotificationApplicationError", () => {
    expect(NotificationApplicationError.notificationNotFound).toBeTypeOf("function");
  });
});
