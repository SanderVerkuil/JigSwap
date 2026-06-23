import { MemberId, SolvingPreferences } from "../../../domain";

export interface GetSolvingPreferencesCommand {
  readonly memberId: MemberId;
}

export interface GetSolvingPreferences {
  (cmd: GetSolvingPreferencesCommand): Promise<SolvingPreferences>;
}
