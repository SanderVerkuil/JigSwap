import { Result } from "../../../../shared-kernel";
import { CopyId, MemberId, SolvingError } from "../../../domain";

// Create or replace the member's single star-only review of a copy (one per member+copy; the
// persistence adapter enforces the cardinality). Only the copy's owner or a member with a
// completion on the copy may review it — the composition root supplies `copyOwnerId` and
// `hasCompletionOnCopy` (the domain does no lookups). `rating` is validated 1–5.
export interface UpsertCopyReviewCommand {
  readonly actingMemberId: MemberId;
  readonly copyId: CopyId;
  readonly copyOwnerId: MemberId;
  readonly hasCompletionOnCopy: boolean;
  readonly rating: number;
}

export interface UpsertCopyReview {
  (cmd: UpsertCopyReviewCommand): Promise<Result<void, SolvingError>>;
}
