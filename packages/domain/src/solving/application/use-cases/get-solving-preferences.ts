import { Clock } from "../../../shared-kernel";
import { SolvingPreferences } from "../../domain";
import {
  GetSolvingPreferences,
  GetSolvingPreferencesCommand,
} from "../ports/in/get-solving-preferences.port";
import { SolvingPreferencesReader } from "../ports/out/solving-preferences.repository";

export interface GetSolvingPreferencesDeps {
  readonly preferences: SolvingPreferencesReader;
  readonly clock: Clock;
}

// Returns the member's stored preferences, or a fresh default (nothing persisted on read).
export const makeGetSolvingPreferences =
  (deps: GetSolvingPreferencesDeps): GetSolvingPreferences =>
  async (cmd: GetSolvingPreferencesCommand) => {
    const existing = await deps.preferences.findByMember(cmd.memberId);
    return (
      existing ??
      SolvingPreferences.createDefault(cmd.memberId, deps.clock.now())
    );
  };
