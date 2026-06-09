import { Result } from "../../../../shared-kernel";
import { CircleId, MemberId } from "../../../domain";

// Create a private circle. `ownerId` is resolved from auth by the transport adapter; the creator
// becomes the owner (implicitly Admin) and the circle's first member.
export interface CreateCircleCommand {
  readonly ownerId: MemberId;
  readonly name: string;
}

// Inbound port: the create-circle use case. Yields the new circle's id on success. Creation never
// fails on a domain rule, so the error channel carries only application-level failures (none today).
export interface CreateCircle {
  (cmd: CreateCircleCommand): Promise<Result<CircleId, never>>;
}
