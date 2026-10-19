import {
  Household,
  HouseholdId,
  HouseholdInvite,
  HouseholdInviteId,
  HouseholdJoinRequest,
  HouseholdJoinRequestId,
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
  // The admin revoked a pending invite: it goes, as if it had never been sent.
  remove(id: HouseholdInviteId): Promise<void>;
  // Dissolution cascade: pending invites to a household that no longer exists are dropped.
  removePendingForHousehold(householdId: HouseholdId): Promise<void>;
}

// Outbound port: persistence for HouseholdJoinRequest aggregates.
export interface HouseholdJoinRequestRepository {
  findById(id: HouseholdJoinRequestId): Promise<HouseholdJoinRequest | null>;
  // One request per (requester, link), ever.
  findByRequesterAndLink(
    requesterId: MemberId,
    linkId: string,
  ): Promise<HouseholdJoinRequest | null>;
  // The requester's requests still waiting (pending or silently declined); lapsing is the caller's.
  listWaitingByRequester(
    requesterId: MemberId,
  ): Promise<readonly HouseholdJoinRequest[]>;
  save(request: HouseholdJoinRequest): Promise<void>;
}

export interface HouseholdIdGenerator {
  next(): HouseholdId;
}

export interface HouseholdInviteIdGenerator {
  next(): HouseholdInviteId;
}

export interface HouseholdJoinRequestIdGenerator {
  next(): HouseholdJoinRequestId;
}
