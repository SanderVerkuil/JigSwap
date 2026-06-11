import { Result } from "../../../../shared-kernel";
import { MemberId } from "../../../domain";
import { IdentityApplicationError } from "../../errors";

// The command to deactivate a Member's account.
export interface DeactivateMemberCommand {
  readonly memberId: MemberId;
}

// Inbound port: the deactivate-member use case. Idempotent (re-deactivating succeeds, emitting
// nothing). Fails with MemberNotFound for an unknown member.
export interface DeactivateMember {
  (
    cmd: DeactivateMemberCommand,
  ): Promise<Result<void, IdentityApplicationError>>;
}
