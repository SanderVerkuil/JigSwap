import { MemberId } from "../../../domain";

export interface SetTrackCompletionDurationCommand {
  readonly memberId: MemberId;
  readonly enabled: boolean;
}

export interface SetTrackCompletionDuration {
  (cmd: SetTrackCompletionDurationCommand): Promise<void>;
}
