import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { EmailAddress } from "./email-address";
import { IdentityError } from "./errors";
import {
  MemberDeactivated,
  MemberRegistered,
  RoleAssigned,
  RoleRevoked,
} from "./events";
import { MemberId } from "./ids";
import { Role } from "./role";
import { Username } from "./username";

// Input to register(): the raw profile fields as they arrive from a Clerk webhook. email and
// username arrive as raw strings and are validated into VOs here; cross-aggregate uniqueness of
// clerkId is an application-layer concern (the repository), not the aggregate's own data.
export interface RegisterProps {
  readonly id: MemberId;
  readonly clerkId: string;
  readonly email: string;
  readonly name: string;
  readonly username?: string;
  readonly avatar?: string;
  readonly bio?: string;
  readonly location?: string;
  readonly preferredLanguage?: string;
  readonly now: Date;
}

// The mutable profile fields a member (or webhook sync) can edit. clerkId/email are not here:
// clerkId is immutable, and email changes flow from Clerk verification, not arbitrary edits.
export interface ProfileUpdate {
  readonly name?: string;
  readonly username?: string;
  readonly avatar?: string;
  readonly bio?: string;
  readonly location?: string;
  readonly preferredLanguage?: string;
}

// The persistable shape, kept deliberately close to the `users` table columns so the later
// mapper is a trivial field-for-field translation (EmailAddress/Username <-> string, the Role
// set <-> a string array, isActive/timestamps as-is).
export interface MemberState {
  readonly id: MemberId;
  readonly clerkId: string;
  readonly email: EmailAddress;
  readonly name: string;
  readonly username?: Username;
  readonly avatar?: string;
  readonly bio?: string;
  readonly location?: string;
  readonly preferredLanguage?: string;
  readonly roles: ReadonlySet<Role>;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Member: the per-Clerk-subject aggregate root and the ACL's internal identity. It owns account
// lifecycle (active/inactive) and the set of elevated roles, deciding only from its own data;
// the one-Member-per-clerkId rule needs the repository and lives in the application layer.
export class Member {
  private events: DomainEvent[] = [];

  private constructor(private state: MemberState) {}

  get id(): MemberId {
    return this.state.id;
  }

  get clerkId(): string {
    return this.state.clerkId;
  }

  get isActive(): boolean {
    return this.state.isActive;
  }

  get roles(): ReadonlySet<Role> {
    return this.state.roles;
  }

  hasRole(role: Role): boolean {
    return this.state.roles.has(role);
  }

  // Mint a brand-new Member for a Clerk subject. Validates the email (and username if given)
  // into VOs and records MemberRegistered. The member starts active with no elevated roles.
  static register(props: RegisterProps): Result<Member, IdentityError> {
    const email = EmailAddress.create(props.email);
    if (email.isErr) return err(email.error);

    const username = Member.parseUsername(props.username);
    if (username.isErr) return err(username.error);

    const member = new Member({
      id: props.id,
      clerkId: props.clerkId,
      email: email.value,
      name: props.name,
      username: username.value,
      avatar: props.avatar,
      bio: props.bio,
      location: props.location,
      preferredLanguage: props.preferredLanguage,
      roles: new Set<Role>(),
      isActive: true,
      createdAt: props.now,
      updatedAt: props.now,
    });
    member.record(
      new MemberRegistered(
        member.id,
        props.clerkId,
        email.value.value,
        props.now,
      ),
    );
    return ok(member);
  }

  // Edit the mutable profile fields. clerkId/email are intentionally not editable here; only the
  // supplied fields change. Validates a new username into a VO. No event: profile edits are not
  // audited (unlike role/lifecycle changes).
  updateProfile(update: ProfileUpdate, now: Date): Result<void, IdentityError> {
    const username =
      update.username === undefined
        ? ok(this.state.username)
        : Member.parseUsername(update.username);
    if (username.isErr) return err(username.error);

    this.state = {
      ...this.state,
      name: update.name ?? this.state.name,
      username: username.value,
      avatar: update.avatar ?? this.state.avatar,
      bio: update.bio ?? this.state.bio,
      location: update.location ?? this.state.location,
      preferredLanguage:
        update.preferredLanguage ?? this.state.preferredLanguage,
      updatedAt: now,
    };
    return ok(undefined);
  }

  // Guard the immutability of clerkId. A Clerk-webhook sync re-asserts the subject it owns; a
  // matching value is a no-op, but a mismatch means the wrong Member was loaded for that subject
  // and is rejected with ClerkIdImmutable rather than silently rebinding the identity.
  ensureClerkId(clerkId: string): Result<void, IdentityError> {
    if (clerkId !== this.state.clerkId) {
      return err(IdentityError.clerkIdImmutable());
    }
    return ok(undefined);
  }

  // Deactivate the account. Idempotent: MemberDeactivated is emitted only on the active →
  // inactive transition, so re-deactivating an already-inactive member is a silent no-op.
  deactivate(now: Date): void {
    if (!this.state.isActive) return;
    this.state = { ...this.state, isActive: false, updatedAt: now };
    this.record(new MemberDeactivated(this.id, now));
  }

  // Grant an elevated role. Audited via RoleAssigned, emitted only when the role is newly added
  // (assigning a role the member already holds is a silent no-op).
  assignRole(role: Role, now: Date): void {
    if (this.state.roles.has(role)) return;
    const roles = new Set(this.state.roles);
    roles.add(role);
    this.state = { ...this.state, roles, updatedAt: now };
    this.record(new RoleAssigned(this.id, role, now));
  }

  // Withdraw an elevated role. Audited via RoleRevoked, emitted only when the role was actually
  // held (revoking a role the member lacks is a silent no-op).
  revokeRole(role: Role, now: Date): void {
    if (!this.state.roles.has(role)) return;
    const roles = new Set(this.state.roles);
    roles.delete(role);
    this.state = { ...this.state, roles, updatedAt: now };
    this.record(new RoleRevoked(this.id, role, now));
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: MemberState): Member {
    return new Member(state);
  }

  toState(): MemberState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }

  // Optional handles collapse "" / undefined to "no username"; any present value is validated.
  private static parseUsername(
    value: string | undefined,
  ): Result<Username | undefined, IdentityError> {
    if (value === undefined || value === "") return ok(undefined);
    return Username.create(value);
  }
}
