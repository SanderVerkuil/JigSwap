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

  it("falls back to the type's default toggles when the type is absent from the stored map", () => {
    const pref = sparse();
    // A type added after this preference row was created has no stored entry; absent means
    // "never asked", not "opted out" -- trade_request's default toggles apply (inApp on, off elsewhere).
    expect(pref.allows("trade_request", "inApp")).toBe(true);
    expect(pref.allows("trade_request", "email")).toBe(false);
  });

  it("still honours an explicitly stored disablement even though it disagrees with the default", () => {
    const pref = NotificationPreference.rehydrate({
      id,
      memberId: alice,
      toggles: {
        puzzle_approved: { inApp: false, email: false, push: false },
      },
      updatedAt: NOW,
    });
    expect(pref.allows("puzzle_approved", "inApp")).toBe(false);
  });

  it("seeds a type from its defaults when first toggling an absent type", () => {
    const pref = sparse();
    pref.enable("trade_request", "email", LATER);
    expect(pref.allows("trade_request", "email")).toBe(true);
    // The freshly-seeded type keeps its default in-app delivery; only email was toggled on.
    expect(pref.allows("trade_request", "inApp")).toBe(true);
    expect(pref.allows("trade_request", "push")).toBe(false);
    // The persisted shape is the FULL resolved map (defaults + the toggle), not just the toggled channel.
    expect(pref.toState().toggles.trade_request).toEqual({
      inApp: true,
      email: true,
      push: false,
    });
  });

  it("enabling email on an untouched type preserves its default in-app delivery", () => {
    const pref = sparse();
    pref.enable("trade_request", "email", LATER);
    // Before this fix, seeding from an all-off map meant enabling email silently disabled inApp.
    expect(pref.allows("trade_request", "inApp")).toBe(true);
  });

  it("a stored entry missing a channel key falls back to that channel's default", () => {
    // Pins the fallback MECHANISM for absent keys (forward-compat for channels added after a row
    // was written); persisted entries have always been full triples, so this shape is synthetic.
    const pref = NotificationPreference.rehydrate({
      id,
      memberId: alice,
      toggles: { trade_request: { email: true } },
      updatedAt: NOW,
    });
    expect(pref.allows("trade_request", "inApp")).toBe(true);
    expect(pref.allows("trade_request", "email")).toBe(true);
    expect(pref.allows("trade_request", "push")).toBe(false);
  });

  it("an explicit stored false always wins over the default (deliberate opt-outs are never overridden)", () => {
    const pref = NotificationPreference.rehydrate({
      id,
      memberId: alice,
      toggles: { trade_request: { inApp: false, email: true, push: false } },
      updatedAt: NOW,
    });
    expect(pref.allows("trade_request", "inApp")).toBe(false);
    expect(pref.resolvedToggles().trade_request).toEqual({
      inApp: false,
      email: true,
      push: false,
    });
  });
});

describe("NotificationPreference.resolvedToggles", () => {
  it("covers every type with explicit triples, stored values winning", () => {
    const pref = NotificationPreference.rehydrate({
      id,
      memberId: alice,
      toggles: {
        // Synthetic partial entry: no inApp key -- pins the per-channel fallback to the default.
        trade_request: { email: true },
      },
      updatedAt: NOW,
    });
    const resolved = pref.resolvedToggles();

    expect(Object.keys(resolved)).toHaveLength(NOTIFICATION_TYPES.length);
    for (const type of NOTIFICATION_TYPES) {
      expect(resolved[type]).toEqual({
        inApp: pref.allows(type, "inApp"),
        email: pref.allows(type, "email"),
        push: pref.allows(type, "push"),
      });
    }
    // The stored channel wins; the absent channel falls back to its default.
    expect(resolved.trade_request).toEqual({
      inApp: true,
      email: true,
      push: false,
    });
    // A type entirely absent from the stored map resolves to plain defaults.
    expect(resolved.goal_achieved).toEqual({
      inApp: true,
      email: false,
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
