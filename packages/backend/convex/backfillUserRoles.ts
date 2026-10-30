"use node";

import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// Daily reconcile of the mirrored `users.role` field (display and admin-only notification
// targeting) with Clerk, its source of truth. The user webhook (users.updateOrCreateUser) keeps
// the mirror current, but a lost or dropped webhook would leave it stale, so this pages the Clerk
// Backend API and patches EVERY member's mirror by clerkId, including clearing rows whose Clerk
// role was removed. Unchanged rows are not written. Runs from crons.ts; to run it now:
//   npx convex run backfillUserRoles:run '{}'
// A deployment without CLERK_SECRET_KEY (a preview) skips it with a warning.
export const run = internalAction({
  args: { pageSize: v.optional(v.number()) },
  handler: async (
    ctx,
    { pageSize },
  ): Promise<{ scanned: number; patched: number }> => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      console.warn(
        "CLERK_SECRET_KEY not set — role mirror not reconciled (expected on preview deployments)",
      );
      return { scanned: 0, patched: 0 };
    }
    const clerkClient = createClerkClient({ secretKey });

    const limit = pageSize ?? 100;
    let offset = 0;
    let scanned = 0;
    let patched = 0;

    // Clerk's list endpoint is offset-paginated; totalCount says when to stop.
    for (;;) {
      const page = await clerkClient.users.getUserList({ limit, offset });
      for (const clerkUser of page.data) {
        const role = (
          clerkUser.publicMetadata as Record<string, unknown> | null | undefined
        )?.role;
        const changed = await ctx.runMutation(internal.users.patchUserRole, {
          clerkId: clerkUser.id,
          role: typeof role === "string" ? role : undefined,
        });
        if (changed) patched += 1;
      }
      scanned += page.data.length;
      offset += page.data.length;
      if (page.data.length < limit || scanned >= page.totalCount) break;
    }

    console.log("role mirror reconciled", { scanned, patched });
    return { scanned, patched };
  },
});
