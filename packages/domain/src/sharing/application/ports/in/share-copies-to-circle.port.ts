import { Result } from "../../../../shared-kernel";
import { CircleId, CopyId, MemberId, SharingError } from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Share several copies into a circle at once (the circle page's multi-select). The actor's seat
// must allow sharing (Exchange or Admin); that each copy is the actor's own is the caller's check,
// as for ShareCopyToCircle.
export interface ShareCopiesToCircleCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
  readonly copyIds: readonly CopyId[];
}

export interface ShareCopiesToCircle {
  (
    cmd: ShareCopiesToCircleCommand,
  ): Promise<Result<void, SharingError | SharingApplicationError>>;
}
