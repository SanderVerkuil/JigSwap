"use node";

import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";

// Admin write path for a member's role. Clerk publicMetadata.role is the source
// of truth for authorization (identity/isAdmin reads the JWT claim); this action
// updates Clerk and then fast-paths the users.role display mirror + audit stamp
// via internal.admin.roleChange.apply. The role union is the allowlist — future
// roles extend it. Steps run IN ORDER so a failed Clerk write mirrors and stamps
// NOTHING (the error surfaces to the client):
//   1. gate — transactional authz (member + JWT admin), target lookup,
//      self-guard (CannotChangeOwnRole).
//   2. Clerk updateUserMetadata — role: null deletes the key. The target's
//      active JWT keeps its old claims until its next refresh; that brief window
//      is accepted (Clerk tokens are short-lived).
//   3. apply — patch the users.role mirror + stamp role_granted/role_revoked.
//      The user.updated webhook reconciles the mirror later regardless.
export const setUserRole = action({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.null()),
  },
  handler: async (ctx, { userId, role }) => {
    const target = await ctx.runQuery(internal.admin.roleChange.gate, {
      userId,
    });

    const clerkClient = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    await clerkClient.users.updateUserMetadata(target.clerkId, {
      publicMetadata: { role },
    });

    await ctx.runMutation(internal.admin.roleChange.apply, {
      userId,
      role,
      actorId: target.actorId,
      clerkId: target.clerkId,
      name: target.name,
    });
  },
});
