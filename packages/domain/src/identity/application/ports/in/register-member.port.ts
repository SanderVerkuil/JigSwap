import { Result } from "../../../../shared-kernel";
import { IdentityError, MemberId } from "../../../domain";

// The command to register (or idempotently resolve) a Member for a Clerk subject. The fields
// mirror the Clerk webhook payload; email/username arrive as raw strings and are validated by
// the Member aggregate.
export interface RegisterMemberCommand {
  readonly clerkId: string;
  readonly email: string;
  readonly name: string;
  readonly username?: string;
  readonly avatar?: string;
  readonly bio?: string;
  readonly location?: string;
  readonly preferredLanguage?: string;
}

// Inbound port: the register-member use case. Idempotent per clerkId — if a Member already
// exists for the subject the existing id is returned, so it never yields AlreadyRegistered.
// Yields the (new or existing) member's id on success.
export interface RegisterMember {
  (cmd: RegisterMemberCommand): Promise<Result<MemberId, IdentityError>>;
}
