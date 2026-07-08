"use node";

import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// One-shot backfill for the mirrored `users.role` display field (pattern: backfillSearchableName,
// except the source of truth is Clerk, so this pages the Clerk Backend API instead of the table).
// Patches EVERY member's mirror by clerkId — including clearing rows whose Clerk role was removed.
// Internal-only; run once from the Convex dashboard/CLI after deploy:
//   npx convex run backfillUserRoles:run '{}'
// Rows written after deploy stay current via the user webhook (users.updateOrCreateUser).
export const run = internalAction({
  args: { pageSize: v.optional(v.number()) },
  handler: async (ctx, { pageSize }) => {
    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    const limit = pageSize ?? 100;
    let offset = 0;
    let scanned = 0;

    // Clerk's list endpoint is offset-paginated; totalCount says when to stop.
    for (;;) {
      const page = await clerkClient.users.getUserList({ limit, offset });
      for (const clerkUser of page.data) {
        const role = (
          clerkUser.publicMetadata as Record<string, unknown> | null | undefined
        )?.role;
        await ctx.runMutation(internal.users.patchUserRole, {
          clerkId: clerkUser.id,
          role: typeof role === "string" ? role : undefined,
        });
      }
      scanned += page.data.length;
      offset += page.data.length;
      if (page.data.length < limit || scanned >= page.totalCount) break;
    }

    return { scanned };
  },
});
