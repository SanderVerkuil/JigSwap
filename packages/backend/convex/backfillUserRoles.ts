"use node";

import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// The mirrored role from a Clerk user's public metadata; anything but a string is no role.
const roleOf = (clerkUser: { publicMetadata: unknown }): string | undefined => {
  const role = (
    clerkUser.publicMetadata as Record<string, unknown> | null | undefined
  )?.role;
  return typeof role === "string" ? role : undefined;
};

// More active members missing from Clerk's list than this means the list is wrong, not that they
// left: a CLERK_SECRET_KEY for another Clerk instance makes every member look gone.
const MAX_GONE = 5;

// What Clerk says about ONE user: their role, "gone" (404), or null when Clerk could not answer.
async function clerkRoleOf(
  clerkClient: ClerkClient,
  clerkId: string,
): Promise<{ role: string | undefined } | "gone" | null> {
  try {
    return { role: roleOf(await clerkClient.users.getUser(clerkId)) };
  } catch (error) {
    if (isClerkAPIResponseError(error) && error.status === 404) return "gone";
    console.warn(
      "role mirror: could not check a member Clerk did not list",
      isClerkAPIResponseError(error)
        ? error.status
        : error instanceof Error
          ? error.name
          : "unknown",
    );
    return null;
  }
}

// Daily reconcile of the mirrored `users.role` field (display and admin-only notification
// targeting) with Clerk, its source of truth. The user webhook (users.updateOrCreateUser) keeps
// the mirror current, but a lost or dropped webhook would leave it stale, so this pages the Clerk
// Backend API and patches, by clerkId, every member who has or should have a role, including clearing
// rows whose Clerk role was removed. Unchanged rows are not written. Then it checks the active
// members the pages did not return: one whose user.deleted webhook was lost for good is gone from
// Clerk (404) and is erased as that webhook would have (users.deleteUser); one the offset paging
// skipped is reconciled like the rest; and one Clerk could not answer for is left for the next run.
// More than MAX_GONE of them changes nothing and logs an error instead. Runs from crons.ts; to run
// it now:
//   npx convex run backfillUserRoles:run '{}'
// A deployment without CLERK_SECRET_KEY (a preview) skips it with a warning.
export const run = internalAction({
  args: { pageSize: v.optional(v.number()) },
  handler: async (
    ctx,
    { pageSize },
  ): Promise<{ scanned: number; patched: number; deleted: number }> => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      console.warn(
        "CLERK_SECRET_KEY not set — role mirror not reconciled (expected on preview deployments)",
      );
      return { scanned: 0, patched: 0, deleted: 0 };
    }
    const clerkClient = createClerkClient({ secretKey });

    const limit = pageSize ?? 100;
    let offset = 0;
    let scanned = 0;
    let patched = 0;
    const seen = new Set<string>();
    const holders = await ctx.runQuery(
      internal.users.listRoleHolderClerkIds,
      {},
    );
    const holderSet = new Set(holders);

    // Clerk's list endpoint is offset-paginated; totalCount says when to stop.
    for (;;) {
      const page = await clerkClient.users.getUserList({ limit, offset });
      for (const clerkUser of page.data) {
        seen.add(clerkUser.id);
        const role = roleOf(clerkUser);
        // No role in Clerk and none mirrored, as for nearly every member: nothing to write, so no
        // function call per member per run.
        if (role === undefined && !holderSet.has(clerkUser.id)) continue;
        const changed = await ctx.runMutation(internal.users.patchUserRole, {
          clerkId: clerkUser.id,
          role,
        });
        if (changed) patched += 1;
      }
      scanned += page.data.length;
      offset += page.data.length;
      if (page.data.length < limit || scanned >= page.totalCount) break;
    }

    const missing: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: FunctionReturnType<typeof internal.users.listActiveClerkIds> =
        await ctx.runQuery(internal.users.listActiveClerkIds, {
          paginationOpts: { numItems: limit, cursor },
        });
      missing.push(...page.clerkIds.filter((clerkId) => !seen.has(clerkId)));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    let deleted = 0;
    if (missing.length > MAX_GONE) {
      console.error(
        "role mirror: too many active members missing from Clerk's user list; none checked. Is CLERK_SECRET_KEY for this Clerk instance?",
        missing.length,
      );
    } else {
      for (const clerkId of missing) {
        const answer = await clerkRoleOf(clerkClient, clerkId);
        if (answer === null) continue;
        if (answer === "gone") {
          await ctx.runMutation(internal.users.deleteUser, { id: clerkId });
          deleted += 1;
        } else if (
          await ctx.runMutation(internal.users.patchUserRole, {
            clerkId,
            role: answer.role,
          })
        ) {
          patched += 1;
        }
      }
    }

    console.log("role mirror reconciled", { scanned, patched, deleted });
    return { scanned, patched, deleted };
  },
});
