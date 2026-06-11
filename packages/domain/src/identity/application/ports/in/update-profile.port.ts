import { Result } from "../../../../shared-kernel";
import { IdentityError, MemberId } from "../../../domain";
import { IdentityApplicationError } from "../../errors";

// The command to edit a Member's mutable profile fields. Only present fields change; clerkId and
// email are intentionally absent (clerkId is immutable, email follows Clerk verification).
export interface UpdateProfileCommand {
  readonly memberId: MemberId;
  readonly name?: string;
  readonly username?: string;
  readonly avatar?: string;
  readonly bio?: string;
  readonly location?: string;
  readonly preferredLanguage?: string;
}

// Inbound port: the update-profile use case. Fails with MemberNotFound for an unknown member or
// InvalidUsername for a malformed handle.
export interface UpdateProfile {
  (
    cmd: UpdateProfileCommand,
  ): Promise<Result<void, IdentityError | IdentityApplicationError>>;
}
