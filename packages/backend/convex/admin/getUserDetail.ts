import {
  ADMIN_USER_STATS_CAP,
  type AdminUserDetailView,
} from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { toAuditEntry } from "./auditEntry";

// Admin read model for ONE member: full profile (email + clerkId — admin-only by
// design), library/activity stats, catalog submissions, and the moderation/audit
// trail split into actions they PERFORMED as admin (by_actor) and actions
// TARGETING them (receivedActions). Admin-only, gated exactly like listUsers.
// Every list/count is an indexed, bounded read: counts stop at
// ADMIN_USER_STATS_CAP + 1, lists are capped, newest first (no pagination in
// v1). The profile's `role` is the DISPLAY-ONLY Clerk mirror — authorization
// never reads it.

const SUBMISSIONS_CAP = 50;
const AUDIT_CAP = 20;

// Actions targeting the member, newest first: rows keyed by their users id (by_target_member,
// SEC-57) plus role rows stamped before it, which key targetId on the Clerk id until
// admin/backfillAuditTargets has rewritten them.
const receivedActions = async (
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<Doc<"moderationActions">[]> => {
  const byMember = await ctx.db
    .query("moderationActions")
    .withIndex("by_target_member", (q) => q.eq("targetMemberId", user._id))
    .order("desc")
    .take(AUDIT_CAP);
  const legacy = await ctx.db
    .query("moderationActions")
    .withIndex("by_target", (q) => q.eq("targetId", user.clerkId))
    .order("desc")
    .take(AUDIT_CAP);
  const unique = new Map([...byMember, ...legacy].map((row) => [row._id, row]));
  return [...unique.values()].sort((a, b) => b.at - a.at).slice(0, AUDIT_CAP);
};

export const getUserDetail = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<AdminUserDetailView> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");

    // Bounded (SEC-71): one row past the cap tells the page there are more.
    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .take(ADMIN_USER_STATS_CAP + 1);
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(ADMIN_USER_STATS_CAP + 1);
    // Solves = finished puzzles only; the table also holds in-progress sessions
    // (isCompleted: false).
    const solves = await ctx.db
      .query("completions")
      .withIndex("by_user_completed", (q) =>
        q.eq("userId", userId).eq("isCompleted", true),
      )
      .take(ADMIN_USER_STATS_CAP + 1);
    const submissions = await ctx.db
      .query("puzzles")
      .withIndex("by_submitted_by", (q) => q.eq("submittedBy", userId))
      .order("desc")
      .take(SUBMISSIONS_CAP);
    const performed = await ctx.db
      .query("moderationActions")
      .withIndex("by_actor", (q) => q.eq("actorId", userId))
      .order("desc")
      .take(AUDIT_CAP);
    const received = await receivedActions(ctx, user);

    return {
      profile: {
        _id: user._id,
        clerkId: user.clerkId,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        location: user.location,
        preferredLanguage: user.preferredLanguage,
        isActive: user.isActive,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      stats: {
        copies: {
          total: copies.length,
          forTrade: copies.filter((c) => c.availability.forTrade).length,
          forSale: copies.filter((c) => c.availability.forSale).length,
          forLend: copies.filter((c) => c.availability.forLend).length,
        },
        collections: collections.length,
        completions: solves.length,
      },
      submissions: submissions.map((p) => ({
        _id: p._id,
        title: p.title,
        status: p.status,
        createdAt: p.createdAt,
      })),
      audit: {
        performed: await Promise.all(
          performed.map((row) => toAuditEntry(ctx, row)),
        ),
        received: await Promise.all(
          received.map((row) => toAuditEntry(ctx, row)),
        ),
      },
    };
  },
});
