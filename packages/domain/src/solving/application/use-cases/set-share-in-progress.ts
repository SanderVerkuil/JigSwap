import { Clock } from "../../../shared-kernel";
import { SolvingPreferences } from "../../domain";
import {
  SetShareInProgress,
  SetShareInProgressCommand,
} from "../ports/in/set-share-in-progress.port";
import { SolvingPreferencesRepository } from "../ports/out/solving-preferences.repository";

export interface SetShareInProgressDeps {
  readonly preferences: SolvingPreferencesRepository;
  readonly clock: Clock;
}

// Upsert the member's in-progress-sharing choice: load or default, mutate, save.
export const makeSetShareInProgress =
  (deps: SetShareInProgressDeps): SetShareInProgress =>
  async (cmd: SetShareInProgressCommand) => {
    const now = deps.clock.now();
    const existing = await deps.preferences.findByMember(cmd.memberId);
    const prefs =
      existing ?? SolvingPreferences.createDefault(cmd.memberId, now);
    prefs.setShareInProgress(cmd.enabled, now);
    await deps.preferences.save(prefs);
  };
