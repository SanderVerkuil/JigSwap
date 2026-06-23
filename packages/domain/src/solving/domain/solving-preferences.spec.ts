import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import { SolvingPreferences } from "./solving-preferences";

const ALICE = toMemberId("alice");
const NOW = new Date("2026-06-01T10:00:00Z");
const LATER = new Date("2026-06-02T10:00:00Z");

describe("SolvingPreferences", () => {
  it("createDefault leaves trackCompletionDuration unset (never asked)", () => {
    const prefs = SolvingPreferences.createDefault(ALICE, NOW);
    expect(prefs.memberId).toBe(ALICE);
    expect(prefs.trackCompletionDuration).toBeUndefined();
  });

  it("setTrackCompletionDuration sets the value and bumps updatedAt", () => {
    const prefs = SolvingPreferences.createDefault(ALICE, NOW);
    prefs.setTrackCompletionDuration(true, LATER);
    expect(prefs.trackCompletionDuration).toBe(true);
    expect(prefs.toState().updatedAt).toEqual(LATER);
  });

  it("setting the same value is a no-op (updatedAt unchanged)", () => {
    const prefs = SolvingPreferences.createDefault(ALICE, NOW);
    prefs.setTrackCompletionDuration(false, LATER);
    const firstUpdate = prefs.toState().updatedAt;
    prefs.setTrackCompletionDuration(false, new Date("2026-06-03T10:00:00Z"));
    expect(prefs.toState().updatedAt).toEqual(firstUpdate);
  });

  it("rehydrate round-trips state", () => {
    const state = {
      memberId: ALICE,
      trackCompletionDuration: true,
      updatedAt: NOW,
    };
    const prefs = SolvingPreferences.rehydrate(state);
    expect(prefs.toState()).toEqual(state);
  });
});
