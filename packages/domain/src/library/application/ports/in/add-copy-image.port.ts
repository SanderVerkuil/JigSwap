import { Result } from "../../../../shared-kernel";
import {
  CopyId,
  CopyImageTag,
  FileId,
  LibraryError,
  OwnerId,
} from "../../../domain";
import { LibraryApplicationError } from "../../errors";

export interface AddCopyImageCommand {
  readonly actingMemberId: OwnerId;
  readonly copyId: CopyId;
  readonly fileId: FileId;
  readonly title?: string;
  readonly description?: string;
  readonly tag?: CopyImageTag;
  readonly takenAt?: Date;
}

export interface AddCopyImage {
  (
    cmd: AddCopyImageCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
