import { Result } from "../../../../shared-kernel";
import { CopyId, MemberId } from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Delete the acting member's own star review of a physical copy. A member holds at most one
// review per copy, so the pair identifies it and nobody can name another member's review.
// `copyId` holds a Convex `ownedPuzzles` doc id, carried under the CopyId brand.
export interface DeleteCopyReviewCommand {
  readonly actingMemberId: MemberId;
  readonly copyId: CopyId;
}

export interface DeleteCopyReview {
  (
    cmd: DeleteCopyReviewCommand,
  ): Promise<Result<void, SolvingApplicationError>>;
}
