import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryNotificationPreferenceRepository,
  RecordingEventPublisher,
  SequentialPreferenceIdGenerator,
} from "../testing";
import {
  makeUpdateNotificationPreference,
  UpdateNotificationPreferenceDeps,
} from "./update-notification-preference";

const alice = toId<"MemberId">("alice") as MemberId;
const NOW = new Date("2026-06-08T10:00:00Z");

let preferences: InMemoryNotificationPreferenceRepository;
let events: RecordingEventPublisher;
let deps: UpdateNotificationPreferenceDeps;

beforeEach(() => {
  preferences = new InMemoryNotificationPreferenceRepository();
  events = new RecordingEventPublisher();
  deps = {
    preferences,
    preferenceIds: new SequentialPreferenceIdGenerator(),
    events,
    clock: new FixedClock(NOW),
  };
});

describe("makeUpdateNotificationPreference", () => {
  it("materialises a default preference then toggles a channel on; allows() reflects it", async () => {
    const update = makeUpdateNotificationPreference(deps);
    const result = await update({
      memberId: alice,
      type: "trade_request",
      channel: "email",
      enabled: true,
    });

    expect(result.isOk).toBe(true);
    const pref = await preferences.findByMember(alice);
    expect(pref?.allows("trade_request", "email")).toBe(true);
    // default inApp still on, untouched.
    expect(pref?.allows("trade_request", "inApp")).toBe(true);
    expect(events.names()).toEqual(["PreferenceChanged"]);
  });

  it("disabling the default inApp channel makes allows() false", async () => {
    const update = makeUpdateNotificationPreference(deps);
    await update({
      memberId: alice,
      type: "trade_request",
      channel: "inApp",
      enabled: false,
    });

    const pref = await preferences.findByMember(alice);
    expect(pref?.allows("trade_request", "inApp")).toBe(false);
    expect(events.names()).toEqual(["PreferenceChanged"]);
  });

  it("publishes nothing when the toggle does not change the value", async () => {
    const update = makeUpdateNotificationPreference(deps);
    // inApp already enabled by default -> enabling again is a no-op.
    const result = await update({
      memberId: alice,
      type: "trade_request",
      channel: "inApp",
      enabled: true,
    });
    expect(result.isOk).toBe(true);
    expect(events.published).toEqual([]);
  });

  it("persists across calls (reuses the stored preference, not a fresh default each time)", async () => {
    const update = makeUpdateNotificationPreference(deps);
    await update({ memberId: alice, type: "trade_request", channel: "email", enabled: true });
    await update({ memberId: alice, type: "trade_accepted", channel: "push", enabled: true });

    expect(preferences.size()).toBe(1);
    const pref = await preferences.findByMember(alice);
    expect(pref?.allows("trade_request", "email")).toBe(true);
    expect(pref?.allows("trade_accepted", "push")).toBe(true);
  });
});
