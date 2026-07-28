import { MemberId } from "../../../domain";

export interface SetShareInProgressCommand {
  readonly memberId: MemberId;
  readonly enabled: boolean;
}

export interface SetShareInProgress {
  (cmd: SetShareInProgressCommand): Promise<void>;
}
