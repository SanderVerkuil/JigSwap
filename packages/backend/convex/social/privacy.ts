import type { ProjectedMember } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";

// Privacy chokepoint for surfacing other members inside a copy's history. The rules below run
// SERVER-SIDE so a hidden member's real identity (id/name/username/avatar) never leaves the
// database: a hidden member is reduced to an opaque, non-reversible `anonRef` before it is returned.

/** A member's profile visibility, defaulting to "public" when they have no profile row. */
export const profileVisibilityOf = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<"public" | "private"> => {
  const row = await ctx.db
    .query("profiles")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();
  return row?.visibility ?? "public";
};

/**
 * True iff a and b follow EACH OTHER (both directed edges exist). a === b is not mutual — callers
 * handle the self case before reaching here.
 */
export const areMutualFollowers = async (
  ctx: QueryCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> => {
  if (a === b) return false;
  const aFollowsB = await ctx.db
    .query("follows")
    .withIndex("by_follower_followee", (q) =>
      q.eq("followerId", a).eq("followeeId", b),
    )
    .first();
  if (!aFollowsB) return false;
  const bFollowsA = await ctx.db
    .query("follows")
    .withIndex("by_follower_followee", (q) =>
      q.eq("followerId", b).eq("followeeId", a),
    )
    .first();
  return bFollowsA !== null;
};

// A tiny deterministic, non-reversible string hash (cyrb53) folded to base36. No crypto import: this
// is an obfuscating reference token, not a security primitive. Same input -> same token, so one
// hidden member reads consistently within a timeline; a different salt (the copyId) yields a
// different token, so the same hidden member can't be correlated across copies.
const cyrb53 = (str: string, seed = 0): string => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36);
};

/** The deterministic, non-reversible reference token for a hidden member under a given salt. */
const anonRefOf = (targetId: string, salt: string): string =>
  cyrb53(`${targetId}:${salt}`);

/**
 * THE privacy chokepoint. Project `targetId`'s identity for `viewerId`, salting any anonymisation
 * with `salt` (pass the copyId so the same hidden member is stable within a timeline but
 * un-correlatable across copies). Rules, in order:
 *   1. target IS the viewer -> revealed (even if the viewer's own profile is private).
 *   2. target user row missing -> anonymous.
 *   3. target's profile is public -> revealed.
 *   4. viewer and target are mutual followers -> revealed.
 *   5. otherwise -> anonymous.
 * In the anonymous branch the returned object carries ONLY `{ anonymous: true, anonRef }` — no real
 * id, name, username, or avatar.
 */
export const projectMemberIdentity = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
  salt: string,
): Promise<ProjectedMember> => {
  if (targetId === viewerId) {
    const self = await ctx.db.get(viewerId);
    if (self) return { anonymous: false, member: toMemberView(self) };
    return { anonymous: true, anonRef: anonRefOf(targetId, salt) };
  }

  const target = await ctx.db.get(targetId);
  if (!target) return { anonymous: true, anonRef: anonRefOf(targetId, salt) };

  if ((await profileVisibilityOf(ctx, targetId)) === "public") {
    return { anonymous: false, member: toMemberView(target) };
  }

  if (await areMutualFollowers(ctx, viewerId, targetId)) {
    return { anonymous: false, member: toMemberView(target) };
  }

  return { anonymous: true, anonRef: anonRefOf(targetId, salt) };
};

/** The public projection of a review author: name + (consent-gated) avatar, or null. */
export type PublicAuthorView = { name: string; avatar: string | null } | null;

/**
 * UNAUTHENTICATED identity projection for public (logged-out, indexable) surfaces — the public
 * catalog's review authors. There is no viewer, so projectMemberIdentity's self/mutual-follower
 * reveals cannot apply: reveal iff the member's profile is PUBLIC, else null (the UI renders a
 * generic "A JigSwap member"). Deliberately far narrower than toMemberView — no username, bio,
 * location, or member id ever leaves the server for a public page, and the avatar additionally
 * requires the member's explicit `shareAvatarPublicly` consent (the existing flag for public
 * marketing surfaces).
 */
export const projectPublicAuthor = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<PublicAuthorView> => {
  const user = await ctx.db.get(memberId);
  if (!user) return null;
  if ((await profileVisibilityOf(ctx, memberId)) !== "public") return null;
  return {
    name: user.name,
    avatar: user.shareAvatarPublicly === true ? (user.avatar ?? null) : null,
  };
};
