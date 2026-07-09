import { Id, toId } from "./identifier";

// Explicit branded-id constructors — one per brand — replacing the bare `toId<"X">(s) as X` idiom
// with a single readable, cast-free call (e.g. `toCopyId(s)`). Each returns `Id<"Brand">`, which is
// definitionally the context's own alias (`type CopyId = Id<"CopyId">`), so the value drops in
// wherever that id type is expected. Centralised here because a brand can be declared in several
// contexts (CopyId, MemberId, OwnerId, ...); one constructor avoids the barrel-collision a
// per-context definition would cause.

export const toMemberId = (value: string): Id<"MemberId"> =>
  toId<"MemberId">(value);
export const toCopyId = (value: string): Id<"CopyId"> => toId<"CopyId">(value);
export const toOwnerId = (value: string): Id<"OwnerId"> =>
  toId<"OwnerId">(value);
export const toPuzzleDefinitionId = (value: string): Id<"PuzzleDefinitionId"> =>
  toId<"PuzzleDefinitionId">(value);
export const toExchangeId = (value: string): Id<"ExchangeId"> =>
  toId<"ExchangeId">(value);
export const toCollectionId = (value: string): Id<"CollectionId"> =>
  toId<"CollectionId">(value);
export const toCatalogCategoryId = (value: string): Id<"CatalogCategoryId"> =>
  toId<"CatalogCategoryId">(value);
export const toFileId = (value: string): Id<"FileId"> => toId<"FileId">(value);
export const toCircleId = (value: string): Id<"CircleId"> =>
  toId<"CircleId">(value);
export const toNotificationId = (value: string): Id<"NotificationId"> =>
  toId<"NotificationId">(value);
export const toThreadId = (value: string): Id<"ThreadId"> =>
  toId<"ThreadId">(value);
export const toCompletionId = (value: string): Id<"CompletionId"> =>
  toId<"CompletionId">(value);
export const toLoanId = (value: string): Id<"LoanId"> => toId<"LoanId">(value);
export const toNotificationPreferenceId = (
  value: string,
): Id<"NotificationPreferenceId"> => toId<"NotificationPreferenceId">(value);
export const toProfileId = (value: string): Id<"ProfileId"> =>
  toId<"ProfileId">(value);
export const toPersonalCategoryId = (value: string): Id<"PersonalCategoryId"> =>
  toId<"PersonalCategoryId">(value);
export const toPartnerReviewId = (value: string): Id<"PartnerReviewId"> =>
  toId<"PartnerReviewId">(value);
export const toReputationProfileId = (
  value: string,
): Id<"ReputationProfileId"> => toId<"ReputationProfileId">(value);
export const toMembershipId = (value: string): Id<"MembershipId"> =>
  toId<"MembershipId">(value);
export const toGoalId = (value: string): Id<"GoalId"> => toId<"GoalId">(value);
export const toFollowId = (value: string): Id<"FollowId"> =>
  toId<"FollowId">(value);
export const toCommentId = (value: string): Id<"CommentId"> =>
  toId<"CommentId">(value);
export const toPhotoCommentId = (value: string): Id<"PhotoCommentId"> =>
  toId<"PhotoCommentId">(value);
export const toPhotoId = (value: string): Id<"PhotoId"> =>
  toId<"PhotoId">(value);
export const toSubmitterId = (value: string): Id<"SubmitterId"> =>
  toId<"SubmitterId">(value);
export const toMessageId = (value: string): Id<"MessageId"> =>
  toId<"MessageId">(value);
export const toChangeProposalId = (value: string): Id<"ChangeProposalId"> =>
  toId<"ChangeProposalId">(value);
