import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  toMemberId,
  toNotificationPreferenceId,
} from "../../shared-kernel";
import { PreferenceChanged } from "./events";

import { NotificationPreference } from "./notification-preference";
import { NOTIFICATION_TYPES } from "./notification-type";

const id = toNotificationPreferenceId("pref1");
const alice = toMemberId("alice");
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

const def = (): NotificationPreference =>
  NotificationPreference.createDefault(id, alice, NOW);

describe("NotificationPreference.createDefault", () => {
  it("enables every type on inApp and disables email/push by default", () => {
    const pref = def();
    for (const type of NOTIFICATION_TYPES) {
      expect(pref.allows(type, "inApp")).toBe(true);
      expect(pref.allows(type, "email")).toBe(false);
      expect(pref.allows(type, "push")).toBe(false);
    }
    expect(pref.id).toBe(id);
    expect(pref.memberId).toBe(alice);
  });

  it("records no events on construction", () => {
    expect(def().pullEvents()).toEqual([]);
  });
});

describe("NotificationPreference.enable / disable", () => {
  it("enable turns a channel on and records PreferenceChanged(enabled=true)", () => {
    const pref = def();
    pref.enable("trade_request", "email", LATER);
    expect(pref.allows("trade_request", "email")).toBe(true);
    const events = pref.pullEvents();
    expect(names(events)).toEqual(["PreferenceChanged"]);
    const changed = events[0] as PreferenceChanged;
    expect(changed.type).toBe("trade_request");
    expect(changed.channel).toBe("email");
    expect(changed.enabled).toBe(true);
    expect(changed.occurredAt).toBe(LATER);
  });

  it("disable turns a channel off and records PreferenceChanged(enabled=false)", () => {
    const pref = def();
    pref.disable("trade_request", "inApp", LATER);
    expect(pref.allows("trade_request", "inApp")).toBe(false);
    const events = pref.pullEvents();
    expect(names(events)).toEqual(["PreferenceChanged"]);
    expect((events[0] as PreferenceChanged).enabled).toBe(false);
  });

  it("is a no-op when the value already matches (no spurious event)", () => {
    const pref = def();
    // inApp is already enabled by default.
    pref.enable("trade_request", "inApp", LATER);
    expect(pref.allows("trade_request", "inApp")).toBe(true);
    expect(pref.pullEvents()).toEqual([]);

    // email is already disabled by default.
    pref.disable("trade_request", "email", LATER);
    expect(pref.allows("trade_request", "email")).toBe(false);
    expect(pref.pullEvents()).toEqual([]);
  });

  it("toggling one (type, channel) leaves other types/channels untouched", () => {
    const pref = def();
    pref.disable("trade_request", "inApp", LATER);
    pref.pullEvents();
    expect(pref.allows("trade_accepted", "inApp")).toBe(true);
    expect(pref.allows("trade_request", "email")).toBe(false);
  });
});

describe("NotificationPreference with a sparse (rehydrated) toggle map", () => {
  const sparse = (): NotificationPreference =>
    NotificationPreference.rehydrate({
      id,
      memberId: alice,
      toggles: {}, // no entry for any type
      updatedAt: NOW,
    });

  it("treats an absent type as disabled without throwing (allows reads safely)", () => {
    const pref = sparse();
    expect(pref.allows("trade_request", "inApp")).toBe(false);
    expect(pref.allows("trade_request", "email")).toBe(false);
  });

  it("seeds an all-off channel map when first toggling an absent type", () => {
    const pref = sparse();
    pref.enable("trade_request", "email", LATER);
    expect(pref.allows("trade_request", "email")).toBe(true);
    // The freshly-seeded type's other channels stay off by default.
    expect(pref.allows("trade_request", "inApp")).toBe(false);
    expect(pref.allows("trade_request", "push")).toBe(false);
    // The persisted shape is the FULL resolved map (explicit falses), not just the toggled channel.
    expect(pref.toState().toggles.trade_request).toEqual({
      inApp: false,
      email: true,
      push: false,
    });
  });
});

describe("NotificationPreference round-trip", () => {
  it("rehydrate restores allows() and does not re-emit", () => {
    const pref = def();
    pref.enable("goal_achieved", "push", LATER);
    pref.pullEvents();
    const state = pref.toState();
    const back = NotificationPreference.rehydrate(state);
    expect(back.allows("goal_achieved", "push")).toBe(true);
    expect(back.allows("goal_achieved", "inApp")).toBe(true);
    expect(back.pullEvents()).toEqual([]);
  });
});
