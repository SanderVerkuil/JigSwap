import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  SetProfileVisibility,
  SetProfileVisibilityCommand,
} from "../ports/in/set-profile-visibility.port";
import { ProfileRepository } from "../ports/out/profile.repository";

export interface SetProfileVisibilityDeps {
  readonly profiles: ProfileRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the member's profile (ProfileNotFound if absent), delegate the
// state change to Profile.changeVisibility, save, then publish ProfileVisibilityChanged. Creating
// a profile is a separate flow; this use case only changes an existing one.
export const makeSetProfileVisibility =
  (deps: SetProfileVisibilityDeps): SetProfileVisibility =>
  async (
    cmd: SetProfileVisibilityCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>> => {
    const profile = await deps.profiles.findByMember(cmd.memberId);
    if (!profile) {
      return err(SocialApplicationError.profileNotFound(cmd.memberId));
    }

    // changeVisibility validates nothing beyond the union type, so it always succeeds; we
    // intentionally do not branch on an impossible error here (unlike edit, whose display-name
    // validation can fail). The use case still returns a Result for a uniform call site.
    profile.changeVisibility(cmd.visibility, deps.clock.now());

    await deps.profiles.save(profile);
    await deps.events.publish(profile.pullEvents());

    return ok(undefined);
  };
