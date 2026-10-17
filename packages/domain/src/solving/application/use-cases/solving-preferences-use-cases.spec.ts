import { describe, expect, test } from "vitest";
// toMemberId lives in shared-kernel (branded-ids.ts) — solving/domain/ids.ts exports only the
// TYPES, not the constructors. Same import path completion-use-cases.spec.ts uses.
import { toMemberId } from "../../../shared-kernel";
import { SolvingPreferences } from "../../domain";
import { FixedClock } from "../testing/fixed-clock";
import { InMemorySolvingPreferencesRepository } from "../testing/in-memory-solving-preferences.repository";
import { makeSetShareInProgress } from "./set-share-in-progress";
import { makeSetTrackCompletionDuration } from "./set-track-completion-duration";

const MEMBER = toMemberId("member-1");

describe("setShareInProgress", () => {
  test("defaults to undefined (never chosen) and persists an explicit true", async () => {
    const preferences = new InMemorySolvingPreferencesRepository();
    const clock = new FixedClock(new Date("2026-07-27T10:00:00Z"));
    const setShareUseCase = makeSetShareInProgress({ preferences, clock });

    expect(await preferences.findByMember(MEMBER)).toBeNull();
    expect(
      SolvingPreferences.createDefault(MEMBER, clock.now()).shareInProgress,
    ).toBeUndefined();

    await setShareUseCase({ memberId: MEMBER, enabled: true });
    const prefs = await preferences.findByMember(MEMBER);
    expect(prefs?.shareInProgress).toBe(true);
  });

  test("persists an explicit false (distinct from never-chosen undefined)", async () => {
    const preferences = new InMemorySolvingPreferencesRepository();
    const clock = new FixedClock(new Date("2026-07-27T10:00:00Z"));
    const setShareUseCase = makeSetShareInProgress({ preferences, clock });

    await setShareUseCase({ memberId: MEMBER, enabled: false });
    const prefs = await preferences.findByMember(MEMBER);
    expect(prefs?.shareInProgress).toBe(false);
  });

  test("does not disturb an existing trackCompletionDuration preference", async () => {
    const preferences = new InMemorySolvingPreferencesRepository();
    const clock = new FixedClock(new Date("2026-07-27T10:00:00Z"));
    const setTrackUseCase = makeSetTrackCompletionDuration({
      preferences,
      clock,
    });
    const setShareUseCase = makeSetShareInProgress({ preferences, clock });

    // Seed an existing record with trackCompletionDuration already set, so the use case must
    // load-mutate-save (set-share-in-progress.ts's `existing ??` branch) rather than start fresh.
    await setTrackUseCase({ memberId: MEMBER, enabled: true });

    await setShareUseCase({ memberId: MEMBER, enabled: true });
    const prefs = await preferences.findByMember(MEMBER);
    expect(prefs?.trackCompletionDuration).toBe(true);
    expect(prefs?.shareInProgress).toBe(true);
  });
});
