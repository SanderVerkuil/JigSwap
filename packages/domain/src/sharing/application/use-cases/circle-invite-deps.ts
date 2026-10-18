import { Clock, DomainEventPublisher } from "../../../shared-kernel";
import {
  CircleInviteIdGenerator,
  CircleInviteRepository,
} from "../ports/out/circle-invite.repository";
import { CircleRepository } from "../ports/out/circle.repository";
import { MembershipIdGenerator } from "../ports/out/id-generators";
import { InvitePolicy } from "../ports/out/invite-policy";

// One dependency bag for the circle-invite use cases; each uses the subset it needs.
export interface CircleInviteDeps {
  readonly circles: CircleRepository;
  readonly invites: CircleInviteRepository;
  readonly policy: InvitePolicy;
  readonly inviteIds: CircleInviteIdGenerator;
  readonly membershipIds: MembershipIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}
