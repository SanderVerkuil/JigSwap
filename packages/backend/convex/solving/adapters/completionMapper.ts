import {
  Completion,
  type CompletionState,
  type CopyId,
  type FileId,
  type MemberId,
  Photo,
  type PuzzleDefinitionId,
  PuzzleReview,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `completions` row and the Completion aggregate. Schema shape stops
// here and never ripples into the domain.

// The insert/patch payload for the completion row (minus Convex-managed `_id`/`_creationTime`).
// The FK columns `puzzleId`/`ownedPuzzleId` are excluded here because the mapper is pure and
// cannot resolve the real `puzzles._id`/`ownedPuzzles._id` from the aggregateIds — the
// repository resolves and supplies them.
export type CompletionRow = Omit<
  Doc<"completions">,
  "_id" | "_creationTime" | "puzzleId" | "ownedPuzzleId"
>;

// Row -> aggregate. The row MUST carry an aggregateId (only domain-written rows do); callers
// guard for it before mapping. `puzzleDefinitionId`/`copyId` are the OUTBOUND aggregateIds,
// supplied by the repository after mapping the stored FK `_id`s back to them.
export const toDomain = (
  row: Doc<"completions">,
  puzzleDefinitionId: PuzzleDefinitionId | undefined,
  copyId: CopyId | undefined,
): Completion => {
  const review =
    row.rating === undefined
      ? undefined
      : PuzzleReview.fromState({ rating: row.rating, text: row.review });

  const state: CompletionState = {
    id: toId<"CompletionId">(row.aggregateId as string),
    userId: toId<"MemberId">(row.userId as unknown as string) as MemberId,
    puzzleDefinitionId,
    copyId,
    startDate: new Date(row.startDate),
    endDate: row.endDate === undefined ? undefined : new Date(row.endDate),
    completionTimeMinutes: row.completionTimeMinutes,
    notes: row.notes,
    photos: row.photos.map((fileId) =>
      Photo.of(toId<"FileId">(fileId as unknown as string) as FileId),
    ),
    review,
    isCompleted: row.isCompleted,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  return Completion.rehydrate(state);
};

// Aggregate -> completion row payload (without the FK columns, which the repository fills with
// the resolved real document ids). The PuzzleReview maps to the `rating`/`review` columns.
export const toRow = (completion: Completion): CompletionRow => {
  const state: CompletionState = completion.toState();
  const reviewState = state.review?.toState();
  return {
    aggregateId: state.id as string,
    userId: state.userId as unknown as Id<"users">,
    startDate: state.startDate.getTime(),
    endDate: state.endDate?.getTime(),
    completionTimeMinutes: state.completionTimeMinutes,
    rating: reviewState?.rating,
    review: reviewState?.text,
    notes: state.notes,
    photos: state.photos.map(
      (photo) => photo.fileId as unknown as Id<"_storage">,
    ),
    isCompleted: state.isCompleted,
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
  };
};
