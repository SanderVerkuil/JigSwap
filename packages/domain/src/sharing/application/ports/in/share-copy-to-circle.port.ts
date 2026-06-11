import { Result } from "../../../../shared-kernel";
import { CircleId, CopyId, MemberId, SharingError } from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Share a copy into a circle, making it visible to its members. The actor must hold Admin. The
// `copyId` references a Library aggregate Sharing never loads — it only announces the link.
export interface ShareCopyToCircleCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
  readonly copyId: CopyId;
}

export interface ShareCopyToCircle {
  (
    cmd: ShareCopyToCircleCommand,
  ): Promise<Result<void, SharingError | SharingApplicationError>>;
}
