import { makeSetProfileVisibility, Profile } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexProfileRepository } from "./adapters/convexProfileRepository";
import { profileIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for changing a profile's visibility: authenticate -> wire adapters -> call the
// use case. The member is derived from auth. WHY the create branch (mirrors editProfile): the
// SetProfileVisibility use case only changes an existing profile (ProfileNotFound otherwise);
// first-time togglers get a profile minted via Profile.create here (with no display name; readers
// fall back to the member's account name) then have their visibility applied, keeping creation a deliberate
// flow while making the toggle work before any explicit profile edit.
export const setProfileVisibility = mutation({
  args: {
    visibility: v.union(v.literal("public"), v.literal("private")),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const profiles = convexProfileRepository(ctx);
    const events = inProcessEventPublisher(ctx);
    const clock = systemClock;

    const existing = await profiles.findByMember(memberId);
    if (!existing) {
      // No display name is seeded: copying the account name froze a stale (or "null null") snapshot
      // and the "Member" placeholder was stored unlocalized. Readers fall back to the live account.
      const created = Profile.create(profileIdGenerator.next(), memberId, {
        now: clock.now(),
      });
      if (created.isErr) throw toConvexError(created.error);
      const changed = created.value.changeVisibility(
        args.visibility,
        clock.now(),
      );
      if (changed.isErr) throw toConvexError(changed.error);
      await profiles.save(created.value);
      await events.publish(created.value.pullEvents());
      return;
    }

    const setVisibilityUseCase = makeSetProfileVisibility({
      profiles,
      events,
      clock,
    });
    const result = await setVisibilityUseCase({
      memberId,
      visibility: args.visibility,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
