import { Result } from "../../../../shared-kernel";
import { Condition, CopyId, LibraryError, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

export interface ChangeCopyConditionCommand {
  readonly actingMemberId: OwnerId;
  readonly copyId: CopyId;
  readonly condition: Condition;
}

export interface ChangeCopyCondition {
  (
    cmd: ChangeCopyConditionCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
