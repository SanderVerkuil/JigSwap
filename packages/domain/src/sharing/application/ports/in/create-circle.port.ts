import { Result } from "../../../../shared-kernel";
import { CircleId, MemberId, SharingError } from "../../../domain";

// Create a private circle. `ownerId` is resolved from auth by the transport adapter; the creator
// becomes the owner (implicitly Admin) and the circle's first member.
export interface CreateCircleCommand {
  readonly ownerId: MemberId;
  readonly name: string;
}

// Inbound port: the create-circle use case. Yields the new circle's id on success, or
// InvalidCircleName when the trimmed name is empty or longer than MAX_CIRCLE_NAME_LENGTH.
export interface CreateCircle {
  (cmd: CreateCircleCommand): Promise<Result<CircleId, SharingError>>;
}
