import { describe, expect, it } from "vitest";
import { DomainEvent, toId } from "../../shared-kernel";
import { PreferenceChanged } from "./events";
import { MemberId, NotificationPreferenceId } from "./ids";
import { NotificationPreference } from "./notification-preference";
import { NOTIFICATION_TYPES } from "./notification-type";

const id = toId<"NotificationPreferenceId">("pref1") as NotificationPreferenceId;
const alice = toId<"MemberId">("alice") as MemberId;
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] => events.map((e) => e.name);

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
