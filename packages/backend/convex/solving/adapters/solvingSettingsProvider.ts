import { makeGetSolvingPreferences, type MemberId } from "@jigswap/domain";
import type { QueryCtx } from "../../_generated/server";
import type { MemberSettingsSection } from "../../settings/memberSettingsSection";
import { convexSolvingPreferencesReader } from "./convexSolvingPreferencesRepository";
import { systemClock } from "./systemClock";

// The Solving context's slice of the federated user settings: { trackCompletionDuration }.
export const solvingSettingsSection: MemberSettingsSection = {
  section: "solving",
  async read(ctx: QueryCtx, memberId: MemberId) {
    const get = makeGetSolvingPreferences({
      preferences: convexSolvingPreferencesReader(ctx),
      clock: systemClock,
    });
    const prefs = await get({ memberId });
    return { trackCompletionDuration: prefs.trackCompletionDuration };
  },
};
