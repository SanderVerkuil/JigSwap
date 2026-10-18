import { Result } from "../../../../shared-kernel";
import { CircleId, MemberId, SharingError } from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Leave a circle. `memberId` is resolved from auth: a member can only ever take themselves out,
// so there is no separate actor. The owner can never leave.
export interface LeaveCircleCommand {
  readonly circleId: CircleId;
  readonly memberId: MemberId;
}

export interface LeaveCircle {
  (
    cmd: LeaveCircleCommand,
  ): Promise<Result<void, SharingError | SharingApplicationError>>;
}
