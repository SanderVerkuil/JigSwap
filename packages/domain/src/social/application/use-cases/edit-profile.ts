import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import { EditProfile, EditProfileCommand } from "../ports/in/edit-profile.port";
import { ProfileRepository } from "../ports/out/profile.repository";

export interface EditProfileDeps {
  readonly profiles: ProfileRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the member's profile (ProfileNotFound if absent), delegate the
// display-name validation to Profile.edit, save, then publish ProfileUpdated. Creating a profile
// is a separate flow; this use case only edits an existing one.
export const makeEditProfile =
  (deps: EditProfileDeps): EditProfile =>
  async (
    cmd: EditProfileCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>> => {
    const profile = await deps.profiles.findByMember(cmd.memberId);
    if (!profile) {
      return err(SocialApplicationError.profileNotFound(cmd.memberId));
    }

    const edited = profile.edit({
      displayName: cmd.displayName,
      bio: cmd.bio,
      now: deps.clock.now(),
    });
    if (edited.isErr) return err(edited.error);

    await deps.profiles.save(profile);
    await deps.events.publish(profile.pullEvents());

    return ok(undefined);
  };
