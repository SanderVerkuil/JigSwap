import { Result } from "../../../../shared-kernel";
import {
  CircleId,
  MemberId,
  PermissionLevel,
  SharingError,
} from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Change a member's permission within a circle. The actor must hold Admin; the owner's Admin
// permission is fixed and cannot be changed.
export interface ChangePermissionCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
  readonly memberId: MemberId;
  readonly permission: PermissionLevel;
}

export interface ChangePermission {
  (
    cmd: ChangePermissionCommand,
  ): Promise<Result<void, SharingError | SharingApplicationError>>;
}
