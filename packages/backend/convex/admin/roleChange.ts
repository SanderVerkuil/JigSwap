import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { stampModerationAction } from "./stampModerationAction";

// Transactional halves of the admin/setUserRole "use node" action. They live in
// this separate NON-node module because a "use node" file may only contain
// actions. The action runs gate (authz re-derivation) BEFORE the Clerk write and
// apply (mirror + audit stamp) AFTER it. Authorization NEVER reads users.role:
// the JWT gate (identity/isAdmin) is the only authz source; the row's role stays
// a display-only mirror.

// Re-derive everything gate-relevant inside one transaction: the caller must be
// a member AND a JWT admin (fails closed), the target row must exist, and an
// admin can never change their OWN role (self-guard on clerkId vs
// identity.subject — a role set overwrites publicMetadata.role wholesale, so
// ANY self-write would be an indirect self-demotion path).
export const gate = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError("User not found");

    // requireMember already proved an identity exists; re-read it for the
    // self-guard comparison.
    const identity = await ctx.auth.getUserIdentity();
    if (identity && target.clerkId === identity.subject) {
      throw new ConvexError("CannotChangeOwnRole");
    }

    return {
      clerkId: target.clerkId,
      name: target.name,
      actorId: memberId as unknown as Id<"users">,
    };
  },
});

// Optimistic fast-path after the Clerk write: atomically patch the display
// mirror (patching `role: undefined` clears the field — the users.patchUserRole
// precedent) and stamp the audit row. The user.updated webhook reconciles the
// mirror later regardless, so this is convenience, not a consistency
// requirement.
export const apply = internalMutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.null()),
    actorId: v.id("users"),
    clerkId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { userId, role, actorId, clerkId, name }) => {
    await ctx.db.patch(userId, { role: role ?? undefined });
    await stampModerationAction(ctx, {
      actorId,
      kind: role === null ? "role_revoked" : "role_granted",
      targetLabel: name,
      targetId: clerkId,
    });
  },
});
