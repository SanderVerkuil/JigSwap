import type { EmailAddressJSON, UserJSON } from "@clerk/backend";
import { normalizeMemberName } from "@jigswap/contracts";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  QueryCtx,
} from "./_generated/server";
import { requireMember } from "./identity/requireMember";
import { normalizeLocation } from "./identity/setLocation";

// The lowercased text backing the `by_searchable_name` people-search index. Kept in sync on every
// user write so member search is an index lookup, not a full-table scan + in-memory filter.
const toSearchableName = (name?: string, username?: string): string =>
  [name, username].filter(Boolean).join(" ").toLowerCase();

// The UserJSON fields updateOrCreateUser reads. The Clerk webhook passes a full UserJSON; tests
// pass just these, so the handler's contract is checked against what it actually uses.
type ClerkUserSync = Pick<
  UserJSON,
  | "id"
  | "first_name"
  | "last_name"
  | "username"
  | "image_url"
  | "created_at"
  | "updated_at"
  | "public_metadata"
  | "primary_email_address_id"
> & {
  email_addresses: (Pick<EmailAddressJSON, "id" | "email_address"> & {
    verification: Pick<
      NonNullable<EmailAddressJSON["verification"]>,
      "status"
    > | null;
  })[];
};

// The Clerk publicMetadata.role, mirrored onto the users row for display (admin users page).
// Display-only: authorization stays JWT-based (identity/isAdmin) and never reads this field.
// UserPublicMetadata is an open record, so read the claim defensively.
const roleOf = (clerkUser: ClerkUserSync): string | undefined => {
  const role = (
    clerkUser.public_metadata as Record<string, unknown> | null | undefined
  )?.role;
  return typeof role === "string" ? role : undefined;
};

// Create or update user from Clerk. Internal only: the canonical user sync happens via the Clerk
// webhook (updateOrCreateUser). Exposing this publicly would let any client upsert a `users` row
// keyed by a client-supplied clerkId (account takeover).
export const createOrUpdateUser = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
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

// Update the Convex-only account fields the profile editor and the language sync write: location
// (same rules as identity/setLocation, via normalizeLocation) and preferredLanguage (a supported
// locale only). An omitted field is left as it is. users.bio is not writable: the public bio is
// profiles.bio (social/editProfile). Username is intentionally NOT writable here either: Clerk is
// its source of truth (uniqueness + validation), mirrored into this `users` row by the
// user.updated webhook (see updateOrCreateUser).
export const updateUserProfile = mutation({
  args: {
    location: v.optional(v.string()),
    preferredLanguage: v.optional(v.union(v.literal("en"), v.literal("nl"))),
  },
  handler: async (ctx, args) => {
    // Ownership: the patched row is the authenticated member, never a client-supplied id (IDOR).
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;
    const patch: Partial<Doc<"users">> = { updatedAt: Date.now() };
    if (args.location !== undefined) {
      const current = (await ctx.db.get(userId))?.location;
      patch.location = normalizeLocation(args.location, current);
    }
    if (args.preferredLanguage !== undefined) {
      patch.preferredLanguage = args.preferredLanguage;
    }
    await ctx.db.patch(userId, patch);
  },
});

/** Get user by Clerk use id (AKA "subject" on auth)  */
export const getUser = internalQuery({
  args: { subject: v.string() },
  async handler(ctx, args) {
    return await userQuery(ctx, args.subject);
  },
});

// The member's email as Clerk vouches for it: the PRIMARY address (by primary_email_address_id, not
// array order), and only once Clerk has verified it. Anything else is undefined, so the caller keeps
// whatever verified email it already stored rather than syncing an address the member may not own.
const verifiedPrimaryEmailOf = (
  clerkUser: ClerkUserSync,
): string | undefined => {
  const primary = (clerkUser.email_addresses ?? []).find(
    (address) => address.id === clerkUser.primary_email_address_id,
  );
  return primary?.verification?.status === "verified"
    ? primary.email_address
    : undefined;
};

// The one-way fingerprint a deleted Clerk account is remembered by (the deletedClerkUsers table):
// hex SHA-256 of the domain-separated Clerk user id. Clerk ids carry over 100 random bits, so the
// fingerprint can't be turned back into the id.
const clerkIdFingerprint = async (clerkId: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`deletedClerkUser/v1:${clerkId}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const deletedClerkUserOf = (ctx: QueryCtx, fingerprint: string) =>
  ctx.db
    .query("deletedClerkUsers")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
    .first();

/**
 * Create a new Clerk user or update existing Clerk user data.
 *
 * Svix delivers Clerk events at least once, in no guaranteed order, and retries for hours, so an
 * event is applied only when it can't undo something newer: never for a deleted account (a
 * deletedClerkUsers tombstone), never onto a deactivated row (a CSAM tombstone keeps its fields
 * blank), and never when its `updated_at` is older than the last event applied (clerkUpdatedAt).
 * An equal `updated_at` is applied again, so a redelivered event is harmless. Any event may
 * insert the row: a user.updated can overtake its user.created, and the older create is then
 * dropped by the order check.
 */
export const updateOrCreateUser = internalMutation({
  args: { clerkUser: v.any() }, // no runtime validation, trust Clerk
  async handler(ctx, { clerkUser }: { clerkUser: ClerkUserSync }) {
    // Logged without the Clerk id: for a deleted account that id is exactly what was erased.
    const fingerprint = await clerkIdFingerprint(clerkUser.id);
    if ((await deletedClerkUserOf(ctx, fingerprint)) !== null) {
      console.warn("Clerk user event ignored: the account was deleted");
      return;
    }
    const userRecord = await userQuery(ctx, clerkUser.id);
    if (userRecord !== null && !userRecord.isActive) {
      console.warn("Clerk user event ignored: the account is deactivated");
      return;
    }
    if (
      userRecord?.clerkUpdatedAt !== undefined &&
      clerkUser.updated_at < userRecord.clerkUpdatedAt
    ) {
      console.warn("Clerk user event ignored: older than the data stored");
      return;
    }

    // Clerk sends `null` for a missing first/last name; interpolating them directly persisted the
    // literal "null null". Keep only the present, non-blank halves; no name at all stays absent.
    const name =
      [clerkUser.first_name, clerkUser.last_name]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(" ") || undefined;
    const username = clerkUser.username ?? undefined;
    const email = verifiedPrimaryEmailOf(clerkUser);
    if (userRecord === null) {
      await ctx.db.insert("users", {
        clerkId: clerkUser.id,
        email,
        name,
        username,
        avatar: clerkUser.image_url,
        searchableName: toSearchableName(name, username),
        role: roleOf(clerkUser),
        bio: undefined,
        isActive: true,
        createdAt: clerkUser.created_at,
        updatedAt: clerkUser.updated_at,
        clerkUpdatedAt: clerkUser.updated_at,
      });
    } else {
      await ctx.db.patch(userRecord._id, {
        clerkId: clerkUser.id,
        // No verified primary: keep the stored email (patching undefined would clear it).
        ...(email !== undefined && { email }),
        name,
        username,
        avatar: clerkUser.image_url,
        searchableName: toSearchableName(name, username),
        role: roleOf(clerkUser),
        updatedAt: clerkUser.updated_at,
        clerkUpdatedAt: clerkUser.updated_at,
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

// One-shot, idempotent cleanup of member names written by the old Clerk sync, which interpolated
// nullable first/last names (`${first_name} ${last_name}`) into "null null" / "Mara null", and by
// the old lazy profile creation, which copied that name (or a hardcoded "Member" placeholder when
// the account name was blank) into profiles.displayName. Internal-only; run per table, users
// FIRST (the profile pass reads the cleaned account name), paging with `cursor` until `isDone`:
//   npx convex run users:backfillMemberNames '{"table":"users"}'
//   npx convex run users:backfillMemberNames '{"table":"profiles"}'
// Re-running is a no-op: rows already clean are left untouched.
export const backfillMemberNames = internalMutation({
  args: {
    table: v.union(v.literal("users"), v.literal("profiles")),
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  async handler(ctx, { table, batchSize, cursor }) {
    const opts = { cursor: cursor ?? null, numItems: batchSize ?? 200 };
    let scanned = 0;
    let patched = 0;
    let page;

    if (table === "users") {
      page = await ctx.db.query("users").paginate(opts);
      for (const user of page.page) {
        const name = normalizeMemberName(user.name);
        const searchableName = toSearchableName(name, user.username);
        if (user.name !== name || user.searchableName !== searchableName) {
          await ctx.db.patch(user._id, { name, searchableName });
          patched += 1;
        }
      }
      scanned = page.page.length;
    } else {
      page = await ctx.db.query("profiles").paginate(opts);
      for (const profile of page.page) {
        let displayName = normalizeMemberName(profile.displayName);
        // "Member" was only ever seeded for an account without a usable name; a named member who
        // typed "Member" themselves keeps it.
        if (displayName === "Member") {
          const account = await ctx.db.get(profile.memberId);
          if (!normalizeMemberName(account?.name)) displayName = undefined;
        }
        if (profile.displayName !== displayName) {
          await ctx.db.patch(profile._id, { displayName });
          patched += 1;
        }
      }
      scanned = page.page.length;
    }

    return {
      patched,
      scanned,
      isDone: page.isDone,
      // Pass this back in as `cursor` to continue paging until `isDone` is true.
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

// Reconcile write for backfillUserRoles: patch the mirrored role onto ONE user row by clerkId.
// Internal-only (never wired to a public endpoint). Patching `role: undefined` clears the field.
// Returns whether the row changed. An unchanged role writes nothing (the daily reconcile visits
// every member), and a deactivated (CSAM-tombstoned) row is left as it is, as in
// updateOrCreateUser. Authorization stays JWT-based (identity/isAdmin).
export const patchUserRole = internalMutation({
  args: { clerkId: v.string(), role: v.optional(v.string()) },
  async handler(ctx, { clerkId, role }): Promise<boolean> {
    const userRecord = await userQuery(ctx, clerkId);
    if (userRecord === null) {
      console.warn("backfillUserRoles: no users row for", clerkId);
      return false;
    }
    if (!userRecord.isActive || userRecord.role === role) return false;
    await ctx.db.patch(userRecord._id, { role });
    return true;
  },
});

// Far more rows than any deployment has admins; it only keeps the read bounded.
const ROLE_HOLDER_LIMIT = 500;

// For backfillUserRoles: the clerkIds of the active members whose mirror carries a role (a
// handful, read through by_role), so the reconcile can check the ones Clerk's user list did not
// return. Internal-only.
export const listRoleHolderClerkIds = internalQuery({
  args: {},
  async handler(ctx): Promise<string[]> {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.gte("role", ""))
      .take(ROLE_HOLDER_LIMIT);
    return rows.filter((row) => row.isActive).map((row) => row.clerkId);
  },
});

/** Delete a user by clerk user ID. */
export const deleteUser = internalMutation({
  args: { id: v.string() },
  async handler(ctx, { id }) {
    // Remember the deletion first, also when there is no row (yet): the user.created event may
    // still be retried after this one. updateOrCreateUser then ignores every later event for this
    // account, on both the hard-delete and the CSAM-tombstone path. Idempotent on redelivery.
    const fingerprint = await clerkIdFingerprint(id);
    if ((await deletedClerkUserOf(ctx, fingerprint)) === null) {
      await ctx.db.insert("deletedClerkUsers", {
        fingerprint,
        deletedAt: Date.now(),
      });
    }

    const userRecord = await userQuery(ctx, id);

    if (userRecord === null) {
      console.warn("can't delete user, does not exist", id);
      return;
    }
    // Their messaging data (attachments, reveals, blocks, filed reports, rate-limit counters) and
    // their circle invites, connection offers, follow edges and follow requests both ways, their
    // invite links and redemptions, their notification inbox and per-member settings; then their
    // open exchanges (cancelled) and loans (returned), the copies they own now with their photos
    // and storage files, their photos and completions elsewhere, goals, collections and personal
    // categories; the circles they own go to another member (or are deleted with nobody left) and
    // they leave their household. In batches after this mutation
    // (conversation/purgeMemberMessagingData). A copy they sold or gave away is never touched: its
    // History stays and names them only as a departed member. Also for a tombstoned
    // member below: a quarantined photo is left whole by the purge, so the CSAM preservation is
    // unaffected. [LAWYER] A lawyer should confirm that purging the rest of a member under an open
    // CSAM escalation is right (versus preserving it with the account).
    await ctx.scheduler.runAfter(
      0,
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: userRecord._id },
    );
    // A member referenced by a CSAM escalation that is not closed yet is TOMBSTONED instead of
    // hard-deleted: the row stays (deactivated, profile and contact fields cleared) so the
    // escalation's uploader reference stays valid while the operator reports it. The escalation
    // keeps its own identity snapshot. [LAWYER] A lawyer should confirm this retention against
    // the GDPR erasure request and the Dutch preservation rules.
    const escalations = await ctx.db
      .query("csamEscalations")
      .withIndex("by_uploader", (q) => q.eq("uploaderId", userRecord._id))
      .collect();
    if (escalations.some((e) => e.status !== "closed")) {
      await ctx.db.patch(userRecord._id, {
        isActive: false,
        email: undefined,
        name: undefined,
        username: undefined,
        slug: undefined,
        avatar: undefined,
        bio: undefined,
        location: undefined,
        searchableName: undefined,
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.delete(userRecord._id);
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
