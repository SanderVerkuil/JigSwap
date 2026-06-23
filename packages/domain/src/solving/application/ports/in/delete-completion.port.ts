import { Result } from "../../../../shared-kernel";
import { CompletionId, MemberId, SolvingError } from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Delete a completion the acting member owns. Allowed at any time (no edit-window restriction).
export interface DeleteCompletionCommand {
  readonly actingMemberId: MemberId;
  readonly completionId: CompletionId;
}

export interface DeleteCompletion {
  (
    cmd: DeleteCompletionCommand,
  ): Promise<Result<void, SolvingError | SolvingApplicationError>>;
}
