import {
  type Comment,
  DisplayName,
  Follow,
  type FollowState,
  type PhotoComment,
  Profile,
  type ProfileState,
  toFollowId,
  toMemberId,
  toProfileId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted Social rows and the aggregates. Schema changes stop here and never
// ripple into the domain. FK columns store the resolved Convex `_id`; aggregateId is the
// aggregate's own branded id.

export type ProfileRow = Omit<Doc<"profiles">, "_id" | "_creationTime">;
export type FollowRow = Omit<Doc<"follows">, "_id" | "_creationTime">;
export type CommentRow = Omit<Doc<"puzzleComments">, "_id" | "_creationTime">;
export type PhotoCommentRow = Omit<
  Doc<"photoComments">,
  "_id" | "_creationTime"
>;

// Row -> Profile aggregate. The row MUST carry an aggregateId (only domain-written rows do).
// DisplayName re-validation here is total: a persisted name was already valid, so `create` succeeds.
export const profileToDomain = (row: Doc<"profiles">): Profile => {
  // A persisted name was valid when written, so a failure here means row corruption, not user input.
  const displayName = DisplayName.create(row.displayName);
  if (!displayName.isOk) {
    throw new Error(
      `Corrupt profile row: invalid displayName "${row.displayName}"`,
    );
  }
  const state: ProfileState = {
    id: toProfileId(row.aggregateId as string),
    memberId: toMemberId(row.memberId),
    displayName: displayName.value,
    bio: row.bio,
    // Legacy rows written before visibility existed are treated as public.
    visibility: row.visibility ?? "public",
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
    visibility: state.visibility,
    updatedAt: state.updatedAt.getTime(),
  };
};

// Row -> Follow aggregate. Re-validation via establish is total here: the persisted edge never
// holds a self-follow, so it succeeds; we fall back to rehydrate to stay defensive.
export const followToDomain = (row: Doc<"follows">): Follow => {
  const state: FollowState = {
    id: toFollowId(row.aggregateId as string),
    followerId: toMemberId(row.followerId),
    followeeId: toMemberId(row.followeeId),
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

// Comment aggregate -> row payload. Domain CommentId becomes `aggregateId`; the PuzzleDefinitionId
// it carries is the catalog puzzle's Convex `_id` (resolved from the owned copy in the mutation),
// re-branded to the `puzzles` FK column. A cleared rating is stored as undefined (column absent).
export const commentToRow = (comment: Comment): CommentRow => {
  const state = comment.toState();
  return {
    aggregateId: state.id as string,
    puzzleId: state.puzzleId as unknown as Id<"puzzles">,
    authorId: state.authorId as unknown as Id<"users">,
    text: state.text.value,
    rating: state.rating?.value,
    createdAt: state.createdAt.getTime(),
  };
};

// PhotoComment aggregate -> row payload. Domain PhotoCommentId becomes `aggregateId`; the PhotoId it
// carries is the `ownedPuzzleImages` _id (passed in by the mutation), re-branded to the `photoId`
// FK column. Photo comments are text-only, so there is no rating field.
export const photoCommentToRow = (comment: PhotoComment): PhotoCommentRow => {
  const state = comment.toState();
  return {
    aggregateId: state.id as string,
    photoId: state.photoId as unknown as Id<"ownedPuzzleImages">,
    authorId: state.authorId as unknown as Id<"users">,
    text: state.text.value,
    createdAt: state.createdAt.getTime(),
  };
};
