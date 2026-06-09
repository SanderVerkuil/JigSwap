import { Result } from "../../../../shared-kernel";
import { MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to edit a member's profile. `memberId` is resolved from auth by the transport
// adapter. The raw `displayName` is validated by the Profile aggregate; `bio` is optional and
// passing undefined clears it.
export interface EditProfileCommand {
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly bio?: string;
}

// Inbound port: the edit-profile use case. Fails with ProfileNotFound when the member has no
// profile yet, or SocialError when the display name is invalid.
export interface EditProfile {
  (
    cmd: EditProfileCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>>;
}
