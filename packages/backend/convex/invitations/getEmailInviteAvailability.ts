import { query } from "../_generated/server";
import { emailInvitesEnabled } from "./config";

// Whether the web shows "Invite by email": true only for a signed-in caller on a deployment with
// the feature switched on (spec E.1, Switch). Exposes nothing but that boolean.
export const getEmailInviteAvailability = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    if ((await ctx.auth.getUserIdentity()) === null) return false;
    return emailInvitesEnabled();
  },
});
