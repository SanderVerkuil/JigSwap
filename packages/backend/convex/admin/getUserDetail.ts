import type { AdminUserDetailView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { type QueryCtx, query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin read model for ONE member: full profile (email + clerkId — admin-only by
// design), library/activity stats, catalog submissions, and the moderation/audit
// trail split into actions they PERFORMED as admin (by_actor) and actions
// TARGETING them (by_target; targetId is the clerkId for role rows). Admin-only,
// gated exactly like listUsers. Every list/count is an indexed read; lists are
// capped, newest first (no pagination in v1). The profile's `role` is the
// DISPLAY-ONLY Clerk mirror — authorization never reads it.

const SUBMISSIONS_CAP = 50;
const AUDIT_CAP = 20;

const toAuditEntry = async (ctx: QueryCtx, row: Doc<"moderationActions">) => ({
  kind: row.kind,
  actorName: row.actorId
    ? ((await ctx.db.get(row.actorId))?.name ?? null)
    : null,
  targetLabel: row.targetLabel,
  targetId: row.targetId,
  at: row.at,
});

export const getUserDetail = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<AdminUserDetailView> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");

    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
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
    const received = await ctx.db
      .query("moderationActions")
      .withIndex("by_target", (q) => q.eq("targetId", user.clerkId))
      .order("desc")
      .take(AUDIT_CAP);

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
        // Solves = finished puzzles only; the table also holds in-progress
        // sessions (isCompleted: false).
        completions: completions.filter((c) => c.isCompleted).length,
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
