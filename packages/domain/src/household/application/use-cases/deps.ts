import { Clock, DomainEventPublisher } from "../../../shared-kernel";
import {
  HouseholdIdGenerator,
  HouseholdInviteIdGenerator,
  HouseholdInviteRepository,
  HouseholdRepository,
} from "../ports/out";

// One dependency bag for the household use cases; each uses the subset it needs.
export interface HouseholdDeps {
  readonly households: HouseholdRepository;
  readonly invites: HouseholdInviteRepository;
  readonly householdIds: HouseholdIdGenerator;
  readonly inviteIds: HouseholdInviteIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}
