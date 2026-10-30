import {
  normalizeMemberName,
  type CommunityAvatarView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { explicitVisibilityOf } from "../social/privacy";
import { mulberry32, partialShuffle } from "./sampling";

// Bounded candidate scan: same guard used across insights — never an unbounded table scan.
const CANDIDATE_SCAN_LIMIT = 200;

// Marketing decoration: cap the caller's requested count.
const LIMIT_MIN = 1;
const LIMIT_MAX = 8;

// Pure mapper: derive a privacy-minimal view of a community member. The raw
// name, username, email, and internal IDs never cross the wire — only two-letter
// initials derived server-side and an optional avatar URL gated on explicit consent.
// Initials come from the name the member shows publicly: their profile display name
// when they chose one, else the account name.
export const toCommunityAvatarView = (
  user: Doc<"users">,
  profile?: Pick<Doc<"profiles">, "displayName"> | null,
): CommunityAvatarView => {
  // normalizeMemberName drops legacy "null null" names, which would otherwise render "NN".
  const name =
    normalizeMemberName(profile?.displayName) ??
    normalizeMemberName(user.name) ??
    "";
  let initials: string;

  if (name.length === 0) {
    initials = "PZ";
  } else {
    const words = name.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 1) {
      // Single word: take first two characters.
      initials = name.slice(0, 2).toUpperCase();
    } else {
      // Multi-word: first letter of first word + first letter of last word.
      initials = (
        (words[0][0] ?? "") + (words[words.length - 1][0] ?? "")
      ).toUpperCase();
    }
  }

  // Avatar URL is only sent when the user explicitly opted in and has an avatar set.
  const image =
    user.shareAvatarPublicly === true && user.avatar ? user.avatar : null;

  return { initials, image };
};

// Insights read (public, no auth): seeded-random sample of active members for
// the marketing trust-row avatar cluster. `limit` is clamped to [1, 8]; `seed`
// drives a deterministic PRNG so the same (seed, DB state) always returns the
// same order. Bounded pool of the 200 most-recent active members, shuffled, then
// walked until `limit` members who EXPLICITLY chose a public profile are found
// (SEC-90): a logged-out surface fails closed like getPublicProfile's anonymous
// path, so members with no profile row, no visibility choice or a private profile
// are never sampled. Fewer than `limit` (even none) is a valid answer; the hero
// hides the cluster when it is empty.
export const getCommunityAvatars = query({
  args: {
    limit: v.number(),
    seed: v.number(),
  },
  handler: async (ctx, args): Promise<CommunityAvatarView[]> => {
    const limit = Math.max(
      LIMIT_MIN,
      Math.min(LIMIT_MAX, Math.trunc(args.limit)),
    );

    // Bounded pool: most-recent active members (no auth required — only
    // privacy-safe initials + opt-in avatar URLs are returned by the mapper).
    const pool = await ctx.db
      .query("users")
      .order("desc")
      .filter((q) => q.eq(q.field("isActive"), true))
      .take(CANDIDATE_SCAN_LIMIT);

    // Shuffle in-place; pool is a fresh array from .take() so mutation is safe. The
    // whole pool is shuffled because hidden members are skipped while walking it.
    const rand = mulberry32(args.seed);
    const shuffled = partialShuffle(pool, pool.length, rand);

    const picked: CommunityAvatarView[] = [];
    for (const user of shuffled) {
      if (picked.length >= limit) break;
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", user._id))
        .unique();
      if (explicitVisibilityOf(profile) !== "public") continue;
      picked.push(toCommunityAvatarView(user, profile));
    }
    return picked;
  },
});
