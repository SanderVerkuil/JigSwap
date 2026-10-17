import { mutation } from "../_generated/server";
import { whatsNewManifest } from "./manifest";
import { markSeen, requireMemberUser } from "./readState";

// Mark every current entry seen (visiting /whats-new).
export const markAllSeen = mutation({
  args: {},
  handler: async (ctx) => {
    const member = await requireMemberUser(ctx);
    await markSeen(
      ctx,
      member,
      whatsNewManifest().map((entry) => entry.id),
    );
  },
});
