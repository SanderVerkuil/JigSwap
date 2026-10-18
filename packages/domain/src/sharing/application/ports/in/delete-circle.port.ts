import { Result } from "../../../../shared-kernel";
import { CircleId, MemberId, SharingError } from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Delete a circle. `actorId` is resolved from auth; only the owner may delete, and only by typing
// the circle's exact name back as `confirmName`.
export interface DeleteCircleCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
  readonly confirmName: string;
}

export interface DeleteCircle {
  (
    cmd: DeleteCircleCommand,
  ): Promise<Result<void, SharingError | SharingApplicationError>>;
}
