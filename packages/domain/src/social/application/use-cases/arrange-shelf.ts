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
  ArrangeShelf,
  ArrangeShelfCommand,
} from "../ports/in/arrange-shelf.port";
import { ProfileRepository } from "../ports/out/profile.repository";

export interface ArrangeShelfDeps {
  readonly profiles: ProfileRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the member's profile (ProfileNotFound if absent), delegate the
// shelf-arrangement to Profile.arrangeShelf, save, then publish ProfileShelfArranged. Creating
// a profile is a separate flow; this use case only curates an existing one.
export const makeArrangeShelf =
  (deps: ArrangeShelfDeps): ArrangeShelf =>
  async (
    cmd: ArrangeShelfCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>> => {
    const profile = await deps.profiles.findByMember(cmd.memberId);
    if (!profile) {
      return err(SocialApplicationError.profileNotFound(cmd.memberId));
    }

    // arrangeShelf always succeeds — no domain validation can fail beyond type safety.
    profile.arrangeShelf(cmd.copyIds, deps.clock.now());

    await deps.profiles.save(profile);
    await deps.events.publish(profile.pullEvents());

    return ok(undefined);
  };
