import {
  type CommentId,
  type CommentIdGenerator,
  type FollowId,
  type FollowIdGenerator,
  type ProfileId,
  type ProfileIdGenerator,
  toCommentId,
  toFollowId,
  toProfileId,
} from "@jigswap/domain";

// Driven adapters for the Social id-generator ports. crypto.randomUUID is available in the Convex
// runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const followIdGenerator: FollowIdGenerator = {
  next: (): FollowId => toFollowId(crypto.randomUUID()),
};

export const profileIdGenerator: ProfileIdGenerator = {
  next: (): ProfileId => toProfileId(crypto.randomUUID()),
};

export const commentIdGenerator: CommentIdGenerator = {
  next: (): CommentId => toCommentId(crypto.randomUUID()),
};
