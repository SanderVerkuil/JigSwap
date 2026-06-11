import { Result } from "../../../../shared-kernel";
import { IdentityError, MemberId } from "../../../domain";
import { IdentityApplicationError } from "../../errors";

// The command to grant an elevated role. The role arrives as a raw string (an admin form / Clerk
// claim) and is validated into a Role by the use case.
export interface AssignRoleCommand {
  readonly memberId: MemberId;
  readonly role: string;
}

// Inbound port: the assign-role use case. Idempotent (re-assigning a held role succeeds, emitting
// nothing). Fails with InvalidRole for an unknown role or MemberNotFound for an unknown member.
export interface AssignRole {
  (
    cmd: AssignRoleCommand,
  ): Promise<Result<void, IdentityError | IdentityApplicationError>>;
}
