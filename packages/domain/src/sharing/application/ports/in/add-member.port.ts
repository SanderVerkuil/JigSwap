import { Result } from "../../../../shared-kernel";
import {
  CircleId,
  MemberId,
  PermissionLevel,
  SharingError,
} from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Add a member to a circle. `actorId` is resolved from auth and must hold Admin in the circle —
// the aggregate enforces that, so the actor is part of the command, never assumed.
export interface AddMemberCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
  readonly memberId: MemberId;
  readonly permission: PermissionLevel;
}

// Inbound port: the add-member use case. Resolves to void on success; the error channel carries the
// domain rule failures (not admin, already a member) and CircleNotFound.
export interface AddMember {
  (
    cmd: AddMemberCommand,
  ): Promise<Result<void, SharingError | SharingApplicationError>>;
}
