import type { LocationAvailabilityView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isLocationConfigured } from "./adapters/mapTiler";
import { participantThreadOf } from "./messageAttachments";
import { isMutualWithOthers } from "./sharedLocations";

// Whether the composer offers "Location" in this thread (spec R.6: inert without a MapTiler key),
// and whether the picker may offer "exact" for a current-location pin (the other participant is a
// mutual follower; sendLocation enforces the same rule). Reads only whether the key is set.
export const locationAvailable = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<LocationAvailabilityView> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const thread = await participantThreadOf(ctx, threadId, me);
    if (!isLocationConfigured(process.env)) {
      return { available: false, exactCurrentLocation: false };
    }
    return {
      available: true,
      exactCurrentLocation: await isMutualWithOthers(
        ctx,
        thread.participants,
        me,
      ),
    };
  },
});
