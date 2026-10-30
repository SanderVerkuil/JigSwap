import {
  canManageHouseholdCopy,
  householdCopyAccess,
  resolveHouseholdCopyPermission,
  toMemberId,
  type CopyManagerPolicy,
  type HouseholdCopyAccess,
  type HouseholdCopyPermission,
  type MemberId,
  type SharedHouseholdFacts,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  householdDefaultOf,
  membershipOf,
  membersOfHousehold,
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

// May the actor act on the copy as if they owned it (owner, or household member at "manage")?
export const canManageCopy = async (
  ctx: QueryCtx,
  actorId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> =>
  canManageHouseholdCopy(await copyAccessOf(ctx, actorId, copy));

// The household facts co-management of an OWNER's copies depends on: their household's default
// copy permission and the other members. Null when the owner is in no household. A bulk reader
// resolves it once per owner and decides each copy with coManagerIdsFrom.
export interface OwnerHousehold {
  readonly defaultCopyPermission: HouseholdCopyPermission | undefined;
  readonly mateIds: ReadonlySet<Id<"users">>;
}

export const ownerHouseholdOf = async (
  ctx: QueryCtx,
  ownerId: Id<"users">,
): Promise<OwnerHousehold | null> => {
  const membership = await membershipOf(ctx, ownerId);
  if (!membership) return null;
  const [defaultCopyPermission, members] = await Promise.all([
    householdDefaultOf(ctx, membership.householdId),
    membersOfHousehold(ctx, membership.householdId),
  ]);
  return {
    defaultCopyPermission,
    mateIds: new Set(
      members.map((m) => m.memberId).filter((id) => id !== ownerId),
    ),
  };
};

// THE co-manager rule — Exchange's CopyView.coManagerIds: the members other than the owner who may
// manage the copy, i.e. the owner's household mates while the copy's effective permission is
// "manage"; nobody when the owner is in no household. `ownerHousehold` must be the copy owner's.
export const coManagerIdsFrom = (
  copy: Doc<"ownedPuzzles">,
  ownerHousehold: OwnerHousehold | null,
): MemberId[] => {
  if (!ownerHousehold) return [];
  const permission = resolveHouseholdCopyPermission(
    copy.householdPermission,
    ownerHousehold.defaultCopyPermission,
  );
  if (permission !== "manage") return [];
  return [...ownerHousehold.mateIds].map((id) => toMemberId(id));
};

// Single-copy form of coManagerIdsFrom.
export const coManagerIdsOf = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
): Promise<MemberId[]> =>
  coManagerIdsFrom(copy, await ownerHouseholdOf(ctx, copy.ownerId));

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
