import { Clock, err, ok, Result } from "../../../shared-kernel";
import { IdentityError } from "../../domain";
import { IdentityApplicationError } from "../errors";
import {
  UpdateProfile,
  UpdateProfileCommand,
} from "../ports/in/update-profile.port";
import { MemberRepository } from "../ports/out/member.repository";

export interface UpdateProfileDeps {
  readonly members: MemberRepository;
  readonly clock: Clock;
}

// Transaction script: load the Member (MemberNotFound if absent) and apply the mutable-field
// edit, delegating username validation to the aggregate. Profile edits are not audited, so there
// is nothing to publish.
export const makeUpdateProfile =
  (deps: UpdateProfileDeps): UpdateProfile =>
  async (
    cmd: UpdateProfileCommand,
  ): Promise<Result<void, IdentityError | IdentityApplicationError>> => {
    const member = await deps.members.findById(cmd.memberId);
    if (!member) return err(IdentityApplicationError.memberNotFound(cmd.memberId));

    const updated = member.updateProfile(
      {
        name: cmd.name,
        username: cmd.username,
        avatar: cmd.avatar,
        bio: cmd.bio,
        location: cmd.location,
        preferredLanguage: cmd.preferredLanguage,
      },
      deps.clock.now(),
    );
    if (updated.isErr) return err(updated.error);

    await deps.members.save(member);
    return ok(undefined);
  };
