import { Clock } from "../../../shared-kernel";
import { SolvingPreferences } from "../../domain";
import {
  SetTrackCompletionDuration,
  SetTrackCompletionDurationCommand,
} from "../ports/in/set-track-completion-duration.port";
import { SolvingPreferencesRepository } from "../ports/out/solving-preferences.repository";

export interface SetTrackCompletionDurationDeps {
  readonly preferences: SolvingPreferencesRepository;
  readonly clock: Clock;
}

// Upsert the member's duration-tracking choice: load or default, mutate, save.
export const makeSetTrackCompletionDuration =
  (deps: SetTrackCompletionDurationDeps): SetTrackCompletionDuration =>
  async (cmd: SetTrackCompletionDurationCommand) => {
    const now = deps.clock.now();
    const existing = await deps.preferences.findByMember(cmd.memberId);
    const prefs =
      existing ?? SolvingPreferences.createDefault(cmd.memberId, now);
    prefs.setTrackCompletionDuration(cmd.enabled, now);
    await deps.preferences.save(prefs);
  };
