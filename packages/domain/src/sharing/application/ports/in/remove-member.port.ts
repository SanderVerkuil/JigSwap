import { Result } from "../../../../shared-kernel";
import { CircleId, MemberId, SharingError } from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Remove a member from a circle. The actor must hold Admin; the owner can never be removed.
export interface RemoveMemberCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
  readonly memberId: MemberId;
}

export interface RemoveMember {
  (
    cmd: RemoveMemberCommand,
  ): Promise<Result<void, SharingError | SharingApplicationError>>;
}
