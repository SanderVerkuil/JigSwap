import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { IdentityError, Member, MemberId } from "../../domain";
import {
  RegisterMember,
  RegisterMemberCommand,
} from "../ports/in/register-member.port";
import { MemberIdGenerator } from "../ports/out/id-generator";
import { MemberRepository } from "../ports/out/member.repository";

export interface RegisterMemberDeps {
  readonly members: MemberRepository;
  readonly memberIds: MemberIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: enforce the one-Member-per-Clerk-subject rule via the repository, then
// delegate field validation (email/username) to Member.register. IDEMPOTENT per clerkId — Clerk
// may deliver the same webhook more than once, so an existing Member is returned unchanged (no
// new id, no event) rather than erroring or duplicating the identity.
export const makeRegisterMember =
  (deps: RegisterMemberDeps): RegisterMember =>
  async (
    cmd: RegisterMemberCommand,
  ): Promise<Result<MemberId, IdentityError>> => {
    const existing = await deps.members.findByClerkId(cmd.clerkId);
    if (existing) return ok(existing.id);

    const member = Member.register({
      id: deps.memberIds.next(),
      clerkId: cmd.clerkId,
      email: cmd.email,
      name: cmd.name,
      username: cmd.username,
      avatar: cmd.avatar,
      bio: cmd.bio,
      location: cmd.location,
      preferredLanguage: cmd.preferredLanguage,
      now: deps.clock.now(),
    });
    if (member.isErr) return err(member.error);

    await deps.members.save(member.value);
    await deps.events.publish(member.value.pullEvents());

    return ok(member.value.id);
  };
