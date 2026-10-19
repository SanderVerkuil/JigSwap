import {
  normalizeMemberName,
  type MemberTeaserIdentity,
  type ProjectedMember,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { householdMateIds } from "../household/memberships";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { toMemberView } from "../identity/toMemberView";
import { blockStateBetween, isBlockedEitherWay } from "./blocks";

// Privacy chokepoint for surfacing other members inside a copy's history. The rules below run
// SERVER-SIDE so a hidden member's real identity (id/name/username/avatar) never leaves the
// database: a hidden member is reduced to an opaque, non-reversible `anonRef` before it is returned.

/**
 * What a member's own direct link (/members/$handle, getPublicMemberTeaser) discloses about them,
 * whatever their profile visibility: display name, username, slug and avatar. Never bio, location,
 * stats or counts. The avatar shows to any signed-in viewer, and to anonymous callers only with
 * the member's shareAvatarPublicly consent.
 */
export const memberTeaserIdentityOf = (
  user: Doc<"users">,
  profile: Doc<"profiles"> | null,
  viewerSignedIn: boolean,
): MemberTeaserIdentity => ({
  memberId: user._id,
  displayName: memberDisplayNameOf(user, profile),
  username: user.username,
  slug: user.slug,
  avatar: viewerSignedIn || user.shareAvatarPublicly ? user.avatar : undefined,
});

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

/**
 * True iff a and b are CURRENTLY members of at least one common circle. Reads only the
 * `circleMembers` junction (the repository keeps it an exact mirror of each circle's memberships,
 * deleting a row the moment a member leaves or is removed), so only real membership counts. The
 * circle owner holds a membership seat, so owner <-> member pairs match too. a === b is not a
 * shared circle — callers handle the self case before reaching here.
 */
export const shareACircle = async (
  ctx: QueryCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> => {
  if (a === b) return false;
  const mine = await ctx.db
    .query("circleMembers")
    .withIndex("by_member", (q) => q.eq("memberId", a))
    .collect();
  for (const membership of mine) {
    const shared = await ctx.db
      .query("circleMembers")
      .withIndex("by_circle_member", (q) =>
        q
          .eq("circleAggregateId", membership.circleAggregateId)
          .eq("memberId", b),
      )
      .first();
    if (shared) return true;
  }
  return false;
};

/**
 * The ordinary identity-reveal rules, shared by every surface that reveals a member: the target's
 * profile is public, or viewer and target are mutual followers. Excludes self (callers handle it),
 * the circle rule and per-trade reveals, which layer on top.
 */
export const isRevealedByOrdinaryRules = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  targetId: Id<"users">,
): Promise<boolean> =>
  (await profileVisibilityOf(ctx, targetId)) === "public" ||
  (await areMutualFollowers(ctx, viewerId, targetId));

/**
 * The profile-content unlock rule (mirrors getPublicProfile's `unlocked`): the viewer may see a
 * member's deeper profile content (puzzles, solves) iff it is the member themself, the member's
 * profile is public, or the two are mutual followers. Never for a pair blocked either way.
 */
export const canSeeProfileContent = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  memberId: Id<"users">,
): Promise<boolean> => {
  if (viewerId === memberId) return true;
  if (await isBlockedEitherWay(ctx, viewerId, memberId)) return false;
  if ((await profileVisibilityOf(ctx, memberId)) === "public") return true;
  return areMutualFollowers(ctx, viewerId, memberId);
};

/**
 * Whether the viewer sees a member's WHOLE library on their profile (every owned copy, open or not)
 * rather than only the copies offered for swap/lend/trade: the member themself, a household mate,
 * or a mutual follower. Mirrors canViewCopy's identity/household/mutual rules (1, 5, 6). Computed
 * server-side only — never taken from a client flag.
 */
export const seesFullLibrary = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  memberId: Id<"users">,
): Promise<boolean> => {
  if (viewerId === memberId) return true;
  if ((await householdMateIds(ctx, viewerId)).has(memberId)) return true;
  return areMutualFollowers(ctx, viewerId, memberId);
};

// anonRef = HMAC-SHA256(ANON_REF_SECRET, JSON.stringify(["anonRef/v1", targetId, salt])), first 80
// bits in base32 (#178). Keyed so it can't be recomputed offline: the salt (copy/thread id) is known
// to the viewer and member ids leak elsewhere, so an unkeyed hash let anyone test candidate ids.
// Same (target, salt, secret) -> same ref, so one hidden member reads consistently within a
// timeline; a different salt yields an uncorrelatable ref. Nothing stores anonRefs, so rotating
// the secret only re-labels hidden members on the next render.
//
// The secret must be at least 32 characters. HMAC-SHA256 wants a key with ~256 bits of entropy;
// `openssl rand -base64 48` (the runbook's command) gives 64 characters, and the floor rejects
// placeholders such as "changeme" or a pasted token prefix that a brute force could cover.
const ANON_REF_SECRET_MIN_LENGTH = 32;
const ANON_REF_BYTES = 10; // 80 bits: ample for a display handle, well above the 64-bit floor.
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

const encoder = new TextEncoder();

const importHmacKey = (raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

// The imported key for the current secret value, reused across invocations in a warm isolate.
let configuredKey: { secret: string; key: Promise<CryptoKey> } | undefined;

// FAIL CLOSED when the secret is unset or too short: never throw (that would break every page
// that shows a hidden member) and NEVER fall back to an unkeyed or default-keyed hash (that is the
// leak this fixes). Instead each request gets a throwaway random key, memoised on its ctx so refs
// stay stable within that one response (the per-page memoisation and UI grouping keep working),
// but they are unreproducible and unlinkable across responses. Convex seeds the query/mutation
// RNG freshly per invocation, so the key is unpredictable to the client; it must be generated
// INSIDE the call (a module-level random value is fixed across runs). Every such request logs a
// loud error naming the variable (never its value), so a misconfigured deployment can't look healthy.
const ephemeralKeys = new WeakMap<object, Promise<CryptoKey>>();

const anonRefKey = (ctx: object): Promise<CryptoKey> => {
  const secret = process.env.ANON_REF_SECRET;
  if (secret !== undefined && secret.length >= ANON_REF_SECRET_MIN_LENGTH) {
    if (configuredKey?.secret !== secret) {
      const entry = {
        secret,
        key: importHmacKey(encoder.encode(secret)),
      };
      // A rejected import must not stay cached: drop it so the next request retries.
      entry.key.catch(() => {
        if (configuredKey === entry) configuredKey = undefined;
      });
      configuredKey = entry;
    }
    return configuredKey.key;
  }
  let key = ephemeralKeys.get(ctx);
  if (!key) {
    console.error(
      `ANON_REF_SECRET is unset or shorter than ${ANON_REF_SECRET_MIN_LENGTH} characters: ` +
        "anonymous member refs fall back to a throwaway per-request key (unstable across " +
        "responses). Set it on this deployment, see docs/deployment/convex-preview-deployments.md.",
    );
    key = importHmacKey(crypto.getRandomValues(new Uint8Array(32)));
    ephemeralKeys.set(ctx, key);
  }
  return key;
};

/** The keyed, non-reversible reference token for a hidden member under a given salt. */
export const anonRefOf = async (
  ctx: QueryCtx,
  targetId: string,
  salt: string,
): Promise<string> => {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await anonRefKey(ctx),
    encoder.encode(JSON.stringify(["anonRef/v1", targetId, salt])),
  );
  // Base32 (RFC 4648 alphabet, lowercase): 80 bits -> exactly 16 characters. No BigInt, since
  // packages/gateway type-checks this file with a pre-ES2020 target.
  let ref = "";
  let bits = 0;
  let value = 0;
  for (const byte of new Uint8Array(signature, 0, ANON_REF_BYTES)) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      ref += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return ref;
};

/**
 * The anonymous projection of `targetId` under `salt`: exactly what projectMemberIdentity emits for
 * a hidden member, for callers that decide visibility through another chokepoint (the per-trade
 * rule) but must keep the same salted reference.
 */
export const anonymousMemberOf = async (
  ctx: QueryCtx,
  targetId: Id<"users">,
  salt: string,
): Promise<Extract<ProjectedMember, { anonymous: true }>> => ({
  anonymous: true,
  anonRef: await anonRefOf(ctx, targetId, salt),
});

/**
 * THE privacy chokepoint. Project `targetId`'s identity for `viewerId`, salting any anonymisation
 * with `salt` (pass the copyId so the same hidden member is stable within a timeline but
 * un-correlatable across copies). Rules, in order:
 *   1. target IS the viewer -> revealed (even if the viewer's own profile is private).
 *   2. target user row missing, or deactivated (`isActive === false`) -> anonymous, `departed`.
 *      Checked before every reveal rule, so a departed member is never named (matching
 *      notifications, which render them "Deleted member"). Then: the target blocked the viewer ->
 *      anonymous, also before every reveal rule below (a block vetoes the circle reveal too). When
 *      the VIEWER blocked the target they are revealed, IDENTITY ONLY (as rule 5): the blocker
 *      needs the name to unblock, and a block never unlocks `bio`, `location` or
 *      `preferredLanguage` (#280).
 *   3. target's profile is public -> revealed.
 *   4. viewer and target are mutual followers -> revealed.
 *   5. viewer and target are currently in the same circle -> revealed, IDENTITY ONLY: name,
 *      username and avatar (the circle member list always showed the avatar), never `bio`,
 *      `location` or `preferredLanguage`. Product decision (#152): sharing a circle counts as a
 *      reveal. It never unlocks profile content (canSeeProfileContent is unchanged).
 *   6. otherwise -> anonymous.
 * Rules 3-4 are `isRevealedByOrdinaryRules`. In the anonymous branch the returned object carries
 * ONLY `{ anonymous: true, anonRef }` (plus `departed`) — no real id, name, username, or avatar.
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
    return { anonymous: true, anonRef: await anonRefOf(ctx, targetId, salt) };
  }

  const target = await ctx.db.get(targetId);
  if (!target || target.isActive === false) {
    return {
      anonymous: true,
      anonRef: await anonRefOf(ctx, targetId, salt),
      departed: true,
    };
  }
  const block = await blockStateBetween(ctx, viewerId, targetId);
  if (block === "byThem") {
    return { anonymous: true, anonRef: await anonRefOf(ctx, targetId, salt) };
  }
  if (block === "byMe") {
    const {
      bio: _bio,
      location: _location,
      preferredLanguage: _preferredLanguage,
      ...identity
    } = toMemberView(target);
    return { anonymous: false, member: identity };
  }

  if (await isRevealedByOrdinaryRules(ctx, viewerId, targetId)) {
    return { anonymous: false, member: toMemberView(target) };
  }

  if (await shareACircle(ctx, viewerId, targetId)) {
    const {
      bio: _bio,
      location: _location,
      preferredLanguage: _preferredLanguage,
      ...identity
    } = toMemberView(target);
    return { anonymous: false, member: identity };
  }

  return { anonymous: true, anonRef: await anonRefOf(ctx, targetId, salt) };
};

/** The public projection of a review author: name + (consent-gated) avatar, or null. */
export type PublicAuthorView = { name?: string; avatar: string | null } | null;

/**
 * UNAUTHENTICATED identity projection for public (logged-out, indexable) surfaces — the public
 * catalog's review authors. There is no viewer, so projectMemberIdentity's self/mutual-follower
 * reveals cannot apply: reveal iff the member has an EXPLICITLY public profile, else null (the UI
 * renders a generic "A JigSwap member"). Deliberately far narrower than toMemberView — no username,
 * bio, location, or member id ever leaves the server for a public page, and the avatar additionally
 * requires the member's explicit `shareAvatarPublicly` consent (the existing flag for public
 * marketing surfaces).
 *
 * FAIL-CLOSED on a missing profile row: unlike `profileVisibilityOf` (which defaults absent rows to
 * "public" — correct for the in-app auth-gated surfaces it gates), this indexable surface reads the
 * profile row directly and reveals ONLY when it exists and is explicitly `visibility: "public"`. A
 * member who never opened profile settings has no row and is anonymized here, so a real display name
 * reaches a Google-indexable page only after an affirmative public choice — not by lazy-creation
 * default. Profiles are created lazily (setProfileVisibility / arrangeShelf), so this matters.
 */
export const projectPublicAuthor = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<PublicAuthorView> => {
  const user = await ctx.db.get(memberId);
  // A departed (deleted or deactivated) author is never revealed, whatever their profile row says.
  if (!user || !user.isActive) return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();
  if (profile?.visibility !== "public") return null;
  return {
    // Account name only (no username/email on public pages); absent = generic member label.
    name: normalizeMemberName(user.name),
    avatar: user.shareAvatarPublicly === true ? (user.avatar ?? null) : null,
  };
};
