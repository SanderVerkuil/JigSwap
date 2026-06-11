import { Result } from "../../../../shared-kernel";
import { IdentityError, MemberId } from "../../../domain";
import { IdentityApplicationError } from "../../errors";

// The command to withdraw an elevated role. The role arrives as a raw string and is validated
// into a Role by the use case.
export interface RevokeRoleCommand {
  readonly memberId: MemberId;
  readonly role: string;
}

// Inbound port: the revoke-role use case. Idempotent (revoking a role the member lacks succeeds,
// emitting nothing). Fails with InvalidRole for an unknown role or MemberNotFound for an unknown
// member.
export interface RevokeRole {
  (
    cmd: RevokeRoleCommand,
  ): Promise<Result<void, IdentityError | IdentityApplicationError>>;
}
