import {
  Household,
  HouseholdId,
  HouseholdInvite,
  HouseholdInviteId,
  MemberId,
} from "../../../domain";

// Outbound port: persistence for Household aggregates (the Convex adapter spans the `households`
// and `householdMembers` tables). `findByMember` backs the at-most-one-household rule.
export interface HouseholdRepository {
  findById(id: HouseholdId): Promise<Household | null>;
  findByMember(memberId: MemberId): Promise<Household | null>;
  save(household: Household): Promise<void>;
  remove(id: HouseholdId): Promise<void>;
}

// Outbound port: persistence for HouseholdInvite aggregates.
export interface HouseholdInviteRepository {
  findById(id: HouseholdInviteId): Promise<HouseholdInvite | null>;
  findPending(
    householdId: HouseholdId,
    inviteeId: MemberId,
  ): Promise<HouseholdInvite | null>;
  save(invite: HouseholdInvite): Promise<void>;
  // Dissolution cascade: pending invites to a household that no longer exists are dropped.
  removePendingForHousehold(householdId: HouseholdId): Promise<void>;
}

export interface HouseholdIdGenerator {
  next(): HouseholdId;
}

export interface HouseholdInviteIdGenerator {
  next(): HouseholdInviteId;
}
