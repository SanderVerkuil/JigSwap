import { UserJSON } from "@clerk/backend";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  QueryCtx,
} from "./_generated/server";
import { requireMember } from "./identity/requireMember";

// The lowercased text backing the `by_searchable_name` people-search index. Kept in sync on every
// user write so member search is an index lookup, not a full-table scan + in-memory filter.
const toSearchableName = (name: string, username?: string): string =>
  [name, username].filter(Boolean).join(" ").toLowerCase();

// Create or update user from Clerk. Internal only: the canonical user sync happens via the Clerk
// webhook (updateOrCreateUser). Exposing this publicly would let any client upsert a `users` row
// keyed by a client-supplied clerkId (account takeover).
export const createOrUpdateUser = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    username: v.optional(v.string()),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    const now = Date.now();

    if (existingUser) {
      // Update existing user
      await ctx.db.patch(existingUser._id, {
        email: args.email,
        name: args.name,
        username: args.username,
        avatar: args.avatar,
        searchableName: toSearchableName(args.name, args.username),
        updatedAt: now,
      });
      return existingUser._id;
    } else {
      // Create new user
      const userId = await ctx.db.insert("users", {
        clerkId: args.clerkId,
        email: args.email,
        name: args.name,
        username: args.username,
        avatar: args.avatar,
        searchableName: toSearchableName(args.name, args.username),
        bio: undefined,
        location: undefined,
        preferredLanguage: "en",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return userId;
    }
  },
});

// Reads (getUserByClerkId, getCurrentUser, getGlobalStats, getUserById, getUserStats, searchUsers)
// were cut over to thin driving adapters under convex/identity/* and convex/insights/getGlobalStats
// (returning typed view DTOs from @jigswap/contracts). Only writes + internal helpers remain here.

// Update the Convex-only profile fields (bio / location / preferredLanguage).
// Username is intentionally NOT writable here: Clerk is its source of truth
// (uniqueness + validation), mirrored into this `users` row by the user.updated
// webhook (see updateOrCreateUser).
export const updateUserProfile = mutation({
  args: {
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Ownership: the patched row is the authenticated member, never a client-supplied id (IDOR).
    const memberId = await requireMember(ctx);
    await ctx.db.patch(memberId as unknown as Id<"users">, {
      ...args,
      updatedAt: Date.now(),
    });
  },
});

/** Get user by Clerk use id (AKA "subject" on auth)  */
export const getUser = internalQuery({
  args: { subject: v.string() },
  async handler(ctx, args) {
    return await userQuery(ctx, args.subject);
  },
});

/** Create a new Clerk user or update existing Clerk user data. */
export const updateOrCreateUser = internalMutation({
  args: { clerkUser: v.any() }, // no runtime validation, trust Clerk
  async handler(ctx, { clerkUser }: { clerkUser: UserJSON }) {
    const userRecord = await userQuery(ctx, clerkUser.id);

    const name = `${clerkUser.first_name} ${clerkUser.last_name}`;
    const username = clerkUser.username ?? undefined;
    if (userRecord === null) {
      await ctx.db.insert("users", {
        clerkId: clerkUser.id,
        email: clerkUser.email_addresses[0].email_address,
        name,
        username,
        avatar: clerkUser.image_url,
        searchableName: toSearchableName(name, username),
        bio: undefined,
        isActive: true,
        createdAt: clerkUser.created_at,
        updatedAt: clerkUser.updated_at,
      });
    } else {
      await ctx.db.patch(userRecord._id, {
        clerkId: clerkUser.id,
        email: clerkUser.email_addresses[0].email_address,
        name,
        username,
        avatar: clerkUser.image_url,
        searchableName: toSearchableName(name, username),
        updatedAt: clerkUser.updated_at,
      });
    }
  },
});

// One-shot backfill for the `searchableName` people-search field on rows created before the index
// existed. Pages the `users` table and patches any row whose `searchableName` is missing or stale.
// Internal-only (never wired to a public endpoint); run once from the Convex dashboard/CLI after
// deploy. Without it, legacy rows only become searchable on their next write (Clerk webhook sync).
export const backfillSearchableName = internalMutation({
  args: { batchSize: v.optional(v.number()), cursor: v.optional(v.string()) },
  async handler(ctx, { batchSize, cursor }) {
    const page = await ctx.db
      .query("users")
      .paginate({ cursor: cursor ?? null, numItems: batchSize ?? 200 });

    let patched = 0;
    for (const user of page.page) {
      const expected = toSearchableName(user.name, user.username);
      if (user.searchableName !== expected) {
        await ctx.db.patch(user._id, { searchableName: expected });
        patched += 1;
      }
    }

    return {
      patched,
      scanned: page.page.length,
      isDone: page.isDone,
      // Pass this back in as `cursor` to continue paging until `isDone` is true.
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Delete a user by clerk user ID. */
export const deleteUser = internalMutation({
  args: { id: v.string() },
  async handler(ctx, { id }) {
    const userRecord = await userQuery(ctx, id);

    if (userRecord === null) {
      console.warn("can't delete user, does not exist", id);
    } else {
      await ctx.db.delete(userRecord._id);
    }
  },
});

export async function userQuery(
  ctx: QueryCtx,
  clerkUserId: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId))
    .unique();
}
