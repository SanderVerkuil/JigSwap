import {
  canManageHouseholdCopy,
  type CopyManagerPolicy,
  type HouseholdCopyAccess,
  householdCopyAccess,
  type HouseholdCopyPermission,
  type MemberId,
  resolveHouseholdCopyPermission,
  type SharedHouseholdFacts,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  householdDefaultOf,
  householdMateIds,
  membershipOf,
} from "./memberships";

// Server-side household authorization over copies, built on the domain's single rule
// (`householdCopyAccess`): owner → "owner"; a member of the owner's household → the copy's
// effective permission (explicit value, else the household default, else "manage"); anyone else →
// "none". Every effective-permission read goes through resolveHouseholdCopyPermission.

// The household the two members share (with its default), or null when they share none.
const sharedHouseholdOf = async (
  ctx: QueryCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<SharedHouseholdFacts | null> => {
  if (a === b) return null;
  const [ma, mb] = await Promise.all([
    membershipOf(ctx, a),
    membershipOf(ctx, b),
  ]);
  if (ma === null || mb === null || ma.householdId !== mb.householdId) {
    return null;
  }
  return {
    defaultCopyPermission: await householdDefaultOf(ctx, ma.householdId),
  };
};

export const copyAccessOf = async (
  ctx: QueryCtx,
  actorId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<HouseholdCopyAccess> =>
  householdCopyAccess(
    {
      ownerId: toMemberId(copy.ownerId),
      householdPermission: copy.householdPermission,
    },
    toMemberId(actorId),
    await sharedHouseholdOf(ctx, actorId, copy.ownerId),
  );

// The permission the copy grants its owner's household right now (explicit value, else the
// owner's household default, else "manage"). Meaningful only while the owner is in a household.
export const effectiveCopyPermission = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
): Promise<HouseholdCopyPermission> => {
  const membership = await membershipOf(ctx, copy.ownerId);
  return resolveHouseholdCopyPermission(
    copy.householdPermission,
    membership
      ? await householdDefaultOf(ctx, membership.householdId)
      : undefined,
  );
};

// May the actor act on the copy as if they owned it (owner, or household member at "manage")?
export const canManageCopy = async (
  ctx: QueryCtx,
  actorId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> =>
  canManageHouseholdCopy(await copyAccessOf(ctx, actorId, copy));

// The members other than the owner who may manage the copy — Exchange's CopyView.coManagerIds.
export const coManagerIdsOf = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
): Promise<MemberId[]> => {
  if ((await effectiveCopyPermission(ctx, copy)) !== "manage") return [];
  return [...(await householdMateIds(ctx, copy.ownerId))].map((id) =>
    toMemberId(id),
  );
};

// Driven adapter for Library's CopyManagerPolicy port. Library hands over the domain CopyId (the
// row's aggregateId); the permission is read from the row.
export const convexCopyManagerPolicy = (ctx: QueryCtx): CopyManagerPolicy => ({
  async canManage(copy, actorId) {
    const row = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", copy.id as string),
      )
      .unique();
    if (!row) return false;
    return canManageCopy(ctx, actorId as unknown as Id<"users">, row);
  },
});
