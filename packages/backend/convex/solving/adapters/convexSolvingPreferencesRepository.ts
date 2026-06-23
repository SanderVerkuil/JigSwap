import {
  type MemberId,
  SolvingPreferences,
  type SolvingPreferencesRepository,
  type SolvingPreferencesState,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

const toDomain = (row: Doc<"solvingPreferences">): SolvingPreferences => {
  const state: SolvingPreferencesState = {
    memberId: toMemberId(row.memberId as unknown as string),
    trackCompletionDuration: row.trackCompletionDuration,
    updatedAt: new Date(row.updatedAt),
  };
  return SolvingPreferences.rehydrate(state);
};

const findRow = (ctx: QueryCtx, memberId: MemberId) =>
  ctx.db
    .query("solvingPreferences")
    .withIndex("by_member", (q) =>
      q.eq("memberId", memberId as unknown as Id<"users">),
    )
    .unique();

// Read-only adapter: satisfies SolvingPreferencesReader from a Convex QueryCtx (the federated
// settings read path runs in a query and must not write).
export const convexSolvingPreferencesReader = (ctx: QueryCtx) => ({
  async findByMember(memberId: MemberId): Promise<SolvingPreferences | null> {
    const row = await findRow(ctx, memberId);
    return row ? toDomain(row) : null;
  },
});

// Full repository: read + upsert, from a MutationCtx.
export const convexSolvingPreferencesRepository = (
  ctx: MutationCtx,
): SolvingPreferencesRepository => ({
  async findByMember(memberId: MemberId): Promise<SolvingPreferences | null> {
    const row = await findRow(ctx, memberId);
    return row ? toDomain(row) : null;
  },
  async save(preferences: SolvingPreferences): Promise<void> {
    const state = preferences.toState();
    const row = {
      memberId: state.memberId as unknown as Id<"users">,
      trackCompletionDuration: state.trackCompletionDuration,
      updatedAt: state.updatedAt.getTime(),
    };
    const existing = await findRow(ctx, state.memberId);
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("solvingPreferences", row);
  },
});
