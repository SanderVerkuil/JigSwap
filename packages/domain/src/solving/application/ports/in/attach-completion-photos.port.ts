import { Result } from "../../../../shared-kernel";
import { CompletionId, FileId, MemberId, SolvingError } from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Attach photos to an existing completion. Window-free (see the aggregate method); enforces
// ownership and the photo cap in the aggregate.
export interface AttachCompletionPhotosCommand {
  readonly actingMemberId: MemberId;
  readonly completionId: CompletionId;
  readonly photoFileIds: readonly FileId[];
}

export interface AttachCompletionPhotos {
  (
    cmd: AttachCompletionPhotosCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
