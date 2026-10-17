import {
  Household,
  type HouseholdId,
  type HouseholdRepository,
  type MemberId,
  toHouseholdId,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for HouseholdRepository over `households` + `householdMembers`. The aggregate's
// member list is persisted as one row per member so `by_member` can answer "which household is
// this member in" (the at-most-one-household rule) with a single index read.
export const convexHouseholdRepository = (
  ctx: MutationCtx,
): HouseholdRepository => {
  const householdRow = (id: HouseholdId): Promise<Doc<"households"> | null> =>
    ctx.db
      .query("households")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  const memberRows = (id: HouseholdId): Promise<Doc<"householdMembers">[]> =>
    ctx.db
      .query("householdMembers")
      .withIndex("by_household", (q) => q.eq("householdId", id as string))
      .collect();

  const load = async (id: HouseholdId): Promise<Household | null> => {
    const row = await householdRow(id);
    if (!row) return null;
    const members = await memberRows(id);
    return Household.rehydrate({
      id,
      createdAt: new Date(row.createdAt),
      defaultCopyPermission: row.defaultCopyPermission,
      members: members.map((m) => ({
        memberId: toMemberId(m.memberId),
        role: m.role,
        joinedAt: new Date(m.joinedAt),
      })),
    });
  };

  return {
    findById: load,

    async findByMember(memberId: MemberId): Promise<Household | null> {
      const membership = await ctx.db
        .query("householdMembers")
        .withIndex("by_member", (q) =>
          q.eq("memberId", memberId as unknown as Id<"users">),
        )
        .first();
      return membership ? load(toHouseholdId(membership.householdId)) : null;
    },

    async save(household: Household): Promise<void> {
      const state = household.toState();
      const row = await householdRow(state.id);
      if (!row) {
        await ctx.db.insert("households", {
          aggregateId: state.id as string,
          createdAt: state.createdAt.getTime(),
          defaultCopyPermission: state.defaultCopyPermission,
        });
      } else if (row.defaultCopyPermission !== state.defaultCopyPermission) {
        await ctx.db.patch(row._id, {
          defaultCopyPermission: state.defaultCopyPermission,
        });
      }
      // Sync member rows to the aggregate: drop departed, update roles, add newcomers.
      const persisted = await memberRows(state.id);
      for (const row of persisted) {
        const current = state.members.find(
          (m) => (m.memberId as string) === (row.memberId as string),
        );
        if (!current) await ctx.db.delete(row._id);
        else if (current.role !== row.role) {
          await ctx.db.patch(row._id, { role: current.role });
        }
      }
      for (const member of state.members) {
        if (
          persisted.some(
            (row) => (row.memberId as string) === (member.memberId as string),
          )
        ) {
          continue;
        }
        await ctx.db.insert("householdMembers", {
          householdId: state.id as string,
          memberId: member.memberId as unknown as Id<"users">,
          role: member.role,
          joinedAt: member.joinedAt.getTime(),
        });
      }
    },

    async remove(id: HouseholdId): Promise<void> {
      for (const row of await memberRows(id)) await ctx.db.delete(row._id);
      const row = await householdRow(id);
      if (row) await ctx.db.delete(row._id);
    },
  };
};
