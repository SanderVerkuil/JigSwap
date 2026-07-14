import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toNotificationPreferenceId } from "../../../shared-kernel";
import { NotificationPreference } from "../../domain";
import {
  FixedClock,
  InMemoryNotificationPreferenceRepository,
  RecordingEventPublisher,
  SequentialPreferenceIdGenerator,
} from "../testing";
import { makeUpdateNotificationPreferences } from "./update-notification-preferences";

const alice = toMemberId("alice");
const NOW = new Date("2026-07-14T10:00:00Z");

let preferences: InMemoryNotificationPreferenceRepository;
let events: RecordingEventPublisher;

const deps = () => ({
  preferences,
  preferenceIds: new SequentialPreferenceIdGenerator(),
  events,
  clock: new FixedClock(NOW),
});

beforeEach(() => {
  preferences = new InMemoryNotificationPreferenceRepository();
  events = new RecordingEventPublisher();
});

describe("makeUpdateNotificationPreferences", () => {
  it("applies every update atomically against one loaded aggregate", async () => {
    const update = makeUpdateNotificationPreferences(deps());
    const result = await update({
      memberId: alice,
      updates: [
        { type: "trade_request", channel: "email", enabled: true },
        { type: "trade_accepted", channel: "email", enabled: true },
        { type: "trade_request", channel: "push", enabled: true },
      ],
    });

    expect(result.isOk).toBe(true);
    expect(preferences.size()).toBe(1);
    const stored = await preferences.findByMember(alice);
    expect(stored?.allows("trade_request", "email")).toBe(true);
    expect(stored?.allows("trade_accepted", "email")).toBe(true);
    expect(stored?.allows("trade_request", "push")).toBe(true);
    // Untouched toggles keep their defaults.
    expect(stored?.allows("trade_declined", "email")).toBe(false);
  });

  it("disables in bulk on an existing preference", async () => {
    const pref = NotificationPreference.createDefault(
      toNotificationPreferenceId("seed"),
      alice,
      NOW,
    );
    pref.enable("trade_request", "email", NOW);
    pref.enable("trade_accepted", "email", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const update = makeUpdateNotificationPreferences(deps());
    await update({
      memberId: alice,
      updates: [
        { type: "trade_request", channel: "email", enabled: false },
        { type: "trade_accepted", channel: "email", enabled: false },
      ],
    });

    const stored = await preferences.findByMember(alice);
    expect(stored?.allows("trade_request", "email")).toBe(false);
    expect(stored?.allows("trade_accepted", "email")).toBe(false);
  });

  it("an empty updates list is a no-op that still succeeds", async () => {
    const update = makeUpdateNotificationPreferences(deps());
    const result = await update({ memberId: alice, updates: [] });
    expect(result.isOk).toBe(true);
  });

  it("saves once and publishes once for a multi-update batch (atomicity)", async () => {
    const update = makeUpdateNotificationPreferences(deps());
    await update({
      memberId: alice,
      updates: [
        { type: "trade_request", channel: "email", enabled: true },
        { type: "trade_accepted", channel: "email", enabled: true },
      ],
    });

    expect(events.batches.length).toBe(1);
    expect(events.names()).toEqual(["PreferenceChanged", "PreferenceChanged"]);
  });

  it("publishes nothing when no update actually changes a value", async () => {
    const update = makeUpdateNotificationPreferences(deps());
    // inApp already enabled by default -> enabling again is a no-op.
    const result = await update({
      memberId: alice,
      updates: [{ type: "trade_request", channel: "inApp", enabled: true }],
    });
    expect(result.isOk).toBe(true);
    expect(events.published).toEqual([]);
  });

  it("reuses the stored preference across calls rather than recreating a default", async () => {
    const update = makeUpdateNotificationPreferences(deps());
    await update({
      memberId: alice,
      updates: [{ type: "trade_request", channel: "email", enabled: true }],
    });
    await update({
      memberId: alice,
      updates: [{ type: "trade_accepted", channel: "push", enabled: true }],
    });

    expect(preferences.size()).toBe(1);
    const pref = await preferences.findByMember(alice);
    expect(pref?.allows("trade_request", "email")).toBe(true);
    expect(pref?.allows("trade_accepted", "push")).toBe(true);
  });
});
