import { makeEditProfile, Profile } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexProfileRepository } from "./adapters/convexProfileRepository";
import { profileIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for editing a profile: authenticate -> wire adapters -> call the use case.
// The member is derived from auth. WHY the create branch: the EditProfile use case only edits an
// existing profile (ProfileNotFound otherwise); first-time editors get a profile minted via
// Profile.create here, keeping creation a deliberate, separate flow from the editing invariant.
export const editProfile = mutation({
  args: { displayName: v.string(), bio: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const profiles = convexProfileRepository(ctx);
    const events = inProcessEventPublisher(ctx);
    const clock = systemClock;

    const existing = await profiles.findByMember(memberId);
    if (!existing) {
      const created = Profile.create(profileIdGenerator.next(), memberId, {
        displayName: args.displayName,
        bio: args.bio,
        now: clock.now(),
      });
      if (created.isErr) throw toConvexError(created.error);
      await profiles.save(created.value);
      await events.publish(created.value.pullEvents());
      return;
    }

    const editProfileUseCase = makeEditProfile({ profiles, events, clock });
    const result = await editProfileUseCase({
      memberId,
      displayName: args.displayName,
      bio: args.bio,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
