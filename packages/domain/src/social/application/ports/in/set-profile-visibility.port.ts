import { Result } from "../../../../shared-kernel";
import { MemberId, ProfileVisibility, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to change a member's profile visibility. `memberId` is resolved from auth by the
// transport adapter; `visibility` is the new public/private setting.
export interface SetProfileVisibilityCommand {
  readonly memberId: MemberId;
  readonly visibility: ProfileVisibility;
}

// Inbound port: the set-profile-visibility use case. Fails with ProfileNotFound when the member
// has no profile yet.
export interface SetProfileVisibility {
  (
    cmd: SetProfileVisibilityCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>>;
}
