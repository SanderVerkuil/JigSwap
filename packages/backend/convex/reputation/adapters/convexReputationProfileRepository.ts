import {
  type MemberId,
  ReputationProfile,
  type ReputationProfileRepository,
  type ReputationProfileState,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for the ReputationProfileRepository port over `ctx.db` (the
// `reputationProfiles` table). The profile is keyed by member; the `memberId` column is a
// `v.id("users")` FK whose value IS the domain MemberId, so no lookup is needed. The
// row<->aggregate translation is inline because it is trivial.
export const convexReputationProfileRepository = (
  ctx: MutationCtx,
): ReputationProfileRepository => {
  const rowByMember = (
    memberId: MemberId,
  ): Promise<Doc<"reputationProfiles"> | null> =>
    ctx.db
      .query("reputationProfiles")
      .withIndex("by_member", (q) =>
        q.eq("memberId", memberId as unknown as Id<"users">),
      )
      .unique();

  const toDomain = (row: Doc<"reputationProfiles">): ReputationProfile => {
    const state: ReputationProfileState = {
      id: toId<"ReputationProfileId">(
        (row.aggregateId ?? (row._id as unknown as string)) as string,
      ),
      memberId: toId<"MemberId">(row.memberId as unknown as string) as MemberId,
      ratingSum: row.ratingSum,
      reviewCount: row.reviewCount,
      averageRating: row.averageRating,
      credibility: row.credibility,
      updatedAt: new Date(row.updatedAt),
    };
    return ReputationProfile.rehydrate(state);
  };

  const toRow = (
    profile: ReputationProfile,
  ): Omit<Doc<"reputationProfiles">, "_id" | "_creationTime"> => {
    const state = profile.toState();
    return {
      aggregateId: state.id as string,
      memberId: state.memberId as unknown as Id<"users">,
      ratingSum: state.ratingSum,
      reviewCount: state.reviewCount,
      averageRating: state.averageRating,
      credibility: state.credibility,
      updatedAt: state.updatedAt.getTime(),
    };
  };

  return {
    async findByMember(memberId: MemberId): Promise<ReputationProfile | null> {
      const row = await rowByMember(memberId);
      return row ? toDomain(row) : null;
    },

    async save(profile: ReputationProfile): Promise<void> {
      const row = toRow(profile);
      // Keyed by member (one profile per member), so upsert on the member, not the aggregateId.
      const existing = await rowByMember(profile.memberId);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("reputationProfiles", row);
    },
  };
};
