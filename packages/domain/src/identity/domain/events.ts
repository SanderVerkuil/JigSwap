import { DomainEvent } from "../../shared-kernel";
import { MemberId } from "./ids";
import { Role } from "./role";

// All Identity domain events implement DomainEvent (name + occurredAt). They are plain immutable
// records: the Member aggregate records them; an outbound publisher dispatches them to
// subscribers (Notifications, Insights). Role changes are audited via RoleAssigned/RoleRevoked.

// A new internal Member was minted for a Clerk subject (the ACL's entry point).
export class MemberRegistered implements DomainEvent {
  readonly name = "MemberRegistered";
  constructor(
    readonly memberId: MemberId,
    readonly clerkId: string,
    readonly email: string,
    readonly occurredAt: Date,
  ) {}
}

// A Member transitioned active → inactive. Emitted once (deactivation is idempotent).
export class MemberDeactivated implements DomainEvent {
  readonly name = "MemberDeactivated";
  constructor(
    readonly memberId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// An elevated role was granted to a Member (the audit trail for privilege escalation).
export class RoleAssigned implements DomainEvent {
  readonly name = "RoleAssigned";
  constructor(
    readonly memberId: MemberId,
    readonly role: Role,
    readonly occurredAt: Date,
  ) {}
}

// An elevated role was withdrawn from a Member (the audit trail for de-escalation).
export class RoleRevoked implements DomainEvent {
  readonly name = "RoleRevoked";
  constructor(
    readonly memberId: MemberId,
    readonly role: Role,
    readonly occurredAt: Date,
  ) {}
}

export type IdentityDomainEvent =
  MemberRegistered | MemberDeactivated | RoleAssigned | RoleRevoked;
