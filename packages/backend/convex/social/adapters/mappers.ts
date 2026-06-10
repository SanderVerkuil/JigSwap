import {
  DisplayName,
  Follow,
  type FollowState,
  type MemberId,
  Profile,
  type ProfileState,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted Social rows and the aggregates. Schema changes stop here and never
// ripple into the domain. FK columns store the resolved Convex `_id`; aggregateId is the
// aggregate's own branded id.

export type ProfileRow = Omit<Doc<"profiles">, "_id" | "_creationTime">;
export type FollowRow = Omit<Doc<"follows">, "_id" | "_creationTime">;

// Row -> Profile aggregate. The row MUST carry an aggregateId (only domain-written rows do).
// DisplayName re-validation here is total: a persisted name was already valid, so `create` succeeds.
export const profileToDomain = (row: Doc<"profiles">): Profile => {
  const displayName = DisplayName.create(row.displayName);
  const state: ProfileState = {
    id: toId<"ProfileId">(row.aggregateId as string),
    memberId: toId<"MemberId">(row.memberId) as MemberId,
    // A persisted row is always valid; fall back to the raw string only to stay total.
    displayName: displayName.isOk
      ? displayName.value
      : DisplayName.create("Member").value,
    bio: row.bio,
    updatedAt: new Date(row.updatedAt),
  };
  return Profile.rehydrate(state);
};

// Profile aggregate -> row payload. Domain ProfileId becomes `aggregateId`; the member id string is
// re-branded to a Convex Id for the FK column.
export const profileToRow = (profile: Profile): ProfileRow => {
  const state = profile.toState();
  return {
    aggregateId: state.id as string,
    memberId: state.memberId as unknown as Id<"users">,
    displayName: state.displayName.value,
    bio: state.bio,
    updatedAt: state.updatedAt.getTime(),
  };
};

// Row -> Follow aggregate. Re-validation via establish is total here: the persisted edge never
// holds a self-follow, so it succeeds; we fall back to rehydrate to stay defensive.
export const followToDomain = (row: Doc<"follows">): Follow => {
  const state: FollowState = {
    id: toId<"FollowId">(row.aggregateId as string),
    followerId: toId<"MemberId">(row.followerId) as MemberId,
    followeeId: toId<"MemberId">(row.followeeId) as MemberId,
    createdAt: new Date(row.createdAt),
  };
  return Follow.rehydrate(state);
};

// Follow aggregate -> row payload. Domain FollowId becomes `aggregateId`; member id strings are
// re-branded to Convex Ids for the FK columns.
export const followToRow = (follow: Follow): FollowRow => {
  const state = follow.toState();
  return {
    aggregateId: state.id as string,
    followerId: state.followerId as unknown as Id<"users">,
    followeeId: state.followeeId as unknown as Id<"users">,
    createdAt: state.createdAt.getTime(),
  };
};
