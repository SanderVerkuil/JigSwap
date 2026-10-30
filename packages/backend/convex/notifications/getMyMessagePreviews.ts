import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { preferenceOrDefault } from "./adapters/convexNotificationPreferenceRepository";

// Read side: whether the caller's email and push notifications for a message may quote its text
// ({ email, push }), resolved through the domain (stored choice, else email no / push yes).
// Side-effect-free: a member with no stored preference gets the defaults.
export const getMyMessagePreviews = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const preference = await preferenceOrDefault(
      ctx,
      memberId as unknown as Id<"users">,
    );
    return preference.resolvedMessagePreviews();
  },
});
