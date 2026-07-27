import type {
  CurrentlySolvingItemView,
  PublicProfileView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { computeMemberStats } from "../identity/getUserStats";
import { optionalActingMember } from "../identity/optionalActingMember";
import { resolveMemberByHandle } from "../identity/resolveMemberByHandle";
import { areMutualFollowers, profileVisibilityOf } from "./privacy";

// The UNAUTHENTICATED read behind the redesigned public member profile. Handle resolution
// (id-first, then slug, then username) is shared with getPublicMemberTeaser via
// identity/resolveMemberByHandle — the SECURITY-critical precedence lives there, once.
//
// Unlocking rule: the deeper story/stats/records are shown when the profile is public, the viewer
// IS the member (isSelf), or the viewer and member are mutual followers. Otherwise the payload is
// LOCKED and carries only `hero` — an Instagram-style private-account header (name, avatar, follow
// counts, rating) that is disclosed regardless of lock state. `location` is the one strict
// exception inside `hero`: it is included ONLY when visibility === "public", in BOTH locked and
// unlocked payloads, with no self/mutual carve-out — see PublicProfileHero's doc.
export const getPublicProfile = query({
  args: { handle: v.string() },
  handler: async (ctx, args): Promise<PublicProfileView | null> => {
    const user = await resolveMemberByHandle(ctx, args.handle);
    if (!user) return null;

    const memberId = user._id;
    const [visibility, profile, viewerId] = await Promise.all([
      profileVisibilityOf(ctx, memberId),
      ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .unique(),
      optionalActingMember(ctx),
    ]);

    const isSelf = viewerId !== null && viewerId === memberId;
    const isMutual =
      !isSelf &&
      viewerId !== null &&
      (await areMutualFollowers(ctx, viewerId, memberId));
    const unlocked = visibility === "public" || isSelf || isMutual;

    // Avatar: any signed-in member may see it; anonymous callers only with explicit public-surface
    // consent. Same rule as getPublicMemberTeaser.
    const avatar =
      viewerId !== null || user.shareAvatarPublicly ? user.avatar : undefined;

    const [
      { puzzlesOwned, tradesCompleted, averageRating, totalReviews },
      followers,
      following,
    ] = await Promise.all([
      computeMemberStats(ctx, memberId),
      // Coarse, capped count — same spirit as getPublicMemberTeaser's puzzleCount: a huge
      // follower/following list can't blow the Convex read limit and 500 this unauthenticated page.
      ctx.db
        .query("follows")
        .withIndex("by_followee", (q) => q.eq("followeeId", memberId))
        .take(1001),
      ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", memberId))
        .take(1001),
    ]);

    const hero = {
      memberId,
      displayName: profile?.displayName ?? user.name,
      username: user.username,
      slug: user.slug,
      avatar,
      memberSince: user.createdAt,
      rating: averageRating,
      reviewCount: totalReviews,
      followerCount: followers.length,
      followingCount: following.length,
      visibility,
      // Strict rule: location is disclosed only on a PUBLIC profile — never for private, even to
      // the owner themselves or a mutual follower. The owner's own edit page handles their
      // location separately.
      location: visibility === "public" ? user.location : undefined,
    };

    if (!unlocked) {
      return { locked: true, hero };
    }

    const story = profile?.bio ? profile.bio : undefined;

    // Single pass over the member's completions backs both `stats` and `records`. Legacy rows may
    // lack a copySnapshot piece count/title; fall back to the joined puzzle definition. Capped —
    // this read is UNAUTHENTICATED, so an uncapped .collect() could be pointed at an arbitrarily
    // large collection and blow the Convex read limit / 500 the page. No real member comes close to
    // 2000 completions; past that the count/piecesPlaced/records undercount rather than erroring.
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", memberId))
      .take(2000);
    const completed = completions.filter((c) => c.isCompleted);

    let piecesPlaced = 0;
    let fastest: { title: string; minutes: number } | null = null;
    let hardest: { title: string; pieceCount: number } | null = null;

    for (const completion of completed) {
      let pieceCount = completion.copySnapshot?.pieceCount;
      let title = completion.copySnapshot?.title;
      if (
        (pieceCount === undefined || title === undefined) &&
        completion.puzzleId
      ) {
        const puzzle = await ctx.db.get(completion.puzzleId);
        if (puzzle) {
          pieceCount ??= puzzle.pieceCount;
          title ??= puzzle.title;
        }
      }

      if (pieceCount !== undefined) {
        piecesPlaced += pieceCount;
        if (
          title !== undefined &&
          (!hardest || pieceCount > hardest.pieceCount)
        ) {
          hardest = { title, pieceCount };
        }
      }

      if (
        completion.completionTimeMinutes !== undefined &&
        title !== undefined
      ) {
        if (!fastest || completion.completionTimeMinutes < fastest.minutes) {
          fastest = { title, minutes: completion.completionTimeMinutes };
        }
      }
    }

    // "Currently solving" — deliberately NARROWER than `unlocked`: this read is unauthenticated
    // and profiles default to public, so riding `unlocked` would expose real-time solving to
    // anonymous visitors. Gate: self always; otherwise mutual follower AND the member's explicit
    // opt-in (`shareInProgress === true`; tri-state, absent = off). Small indexed read (not the
    // .take(2000) scan above, which takes the OLDEST rows and could miss new starts).
    let currentlySolving: CurrentlySolvingItemView[] | undefined;
    if (isSelf || isMutual) {
      const prefs = await ctx.db
        .query("solvingPreferences")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .unique();
      if (isSelf || prefs?.shareInProgress === true) {
        const now = Date.now();
        const inProgress = await ctx.db
          .query("completions")
          .withIndex("by_user_completed", (q) =>
            q.eq("userId", memberId).eq("isCompleted", false),
          )
          .collect();
        const shown = inProgress
          .filter((c) => c.startDate <= now)
          .sort((a, b) => b.startDate - a.startDate)
          .slice(0, 10);
        currentlySolving = await Promise.all(
          shown.map(async (c) => {
            let title = c.copySnapshot?.title;
            let pieceCount = c.copySnapshot?.pieceCount;
            let thumbnailUrl: string | undefined;
            const puzzle = c.puzzleId ? await ctx.db.get(c.puzzleId) : null;
            if (puzzle) {
              title ??= puzzle.title;
              pieceCount ??= puzzle.pieceCount;
              if (puzzle.image) {
                thumbnailUrl =
                  (await ctx.storage.getUrl(puzzle.image)) ?? undefined;
              }
            }
            return { title, pieceCount, startDate: c.startDate, thumbnailUrl };
          }),
        );
      }
    }

    return {
      locked: false,
      hero,
      story,
      stats: {
        puzzlesOwned,
        completions: completed.length,
        piecesPlaced,
        swaps: tradesCompleted,
      },
      records: { fastest, hardest },
      currentlySolving,
    };
  },
});
