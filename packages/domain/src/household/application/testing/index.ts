import {
  Clock,
  DomainEvent,
  DomainEventPublisher,
  toHouseholdId,
  toHouseholdInviteId,
  toHouseholdJoinRequestId,
} from "../../../shared-kernel";
import {
  Household,
  HouseholdId,
  HouseholdInvite,
  HouseholdInviteId,
  HouseholdJoinRequest,
  HouseholdJoinRequestId,
  MemberId,
} from "../../domain";
import {
  HouseholdIdGenerator,
  HouseholdInviteIdGenerator,
  HouseholdInviteRepository,
  HouseholdJoinRequestIdGenerator,
  HouseholdJoinRequestRepository,
  HouseholdRepository,
} from "../ports/out";

// Test doubles for the household use-case specs. Repositories store persisted state and rehydrate a
// fresh aggregate on read, mirroring the adapter round-trip.

export class InMemoryHouseholdRepository implements HouseholdRepository {
  private readonly store = new Map<
    HouseholdId,
    ReturnType<Household["toState"]>
  >();

  async findById(id: HouseholdId): Promise<Household | null> {
    const state = this.store.get(id);
    return state ? Household.rehydrate(state) : null;
  }

  async findByMember(memberId: MemberId): Promise<Household | null> {
    for (const state of this.store.values()) {
      if (state.members.some((m) => m.memberId === memberId)) {
        return Household.rehydrate(state);
      }
    }
    return null;
  }

  async save(household: Household): Promise<void> {
    this.store.set(household.id, household.toState());
  }

  async remove(id: HouseholdId): Promise<void> {
    this.store.delete(id);
  }
}

export class InMemoryHouseholdInviteRepository implements HouseholdInviteRepository {
  private readonly store = new Map<
    HouseholdInviteId,
    ReturnType<HouseholdInvite["toState"]>
  >();

  async findById(id: HouseholdInviteId): Promise<HouseholdInvite | null> {
    const state = this.store.get(id);
    return state ? HouseholdInvite.rehydrate(state) : null;
  }

  async findPending(
    householdId: HouseholdId,
    inviteeId: MemberId,
  ): Promise<HouseholdInvite | null> {
    for (const state of this.store.values()) {
      if (
        state.householdId === householdId &&
        state.inviteeId === inviteeId &&
        state.status === "pending"
      ) {
        return HouseholdInvite.rehydrate(state);
      }
    }
    return null;
  }

  async save(invite: HouseholdInvite): Promise<void> {
    this.store.set(invite.id, invite.toState());
  }

  async remove(id: HouseholdInviteId): Promise<void> {
    this.store.delete(id);
  }

  async removePendingForHousehold(householdId: HouseholdId): Promise<void> {
    for (const [id, state] of this.store) {
      if (state.householdId === householdId && state.status === "pending") {
        this.store.delete(id);
      }
    }
  }
}

export class InMemoryHouseholdJoinRequestRepository implements HouseholdJoinRequestRepository {
  private readonly store = new Map<
    HouseholdJoinRequestId,
    ReturnType<HouseholdJoinRequest["toState"]>
  >();

  async findById(
    id: HouseholdJoinRequestId,
  ): Promise<HouseholdJoinRequest | null> {
    const state = this.store.get(id);
    return state ? HouseholdJoinRequest.rehydrate(state) : null;
  }

  async findByRequesterAndLink(
    requesterId: MemberId,
    linkId: string,
  ): Promise<HouseholdJoinRequest | null> {
    for (const state of this.store.values()) {
      if (state.requesterId === requesterId && state.linkId === linkId) {
        return HouseholdJoinRequest.rehydrate(state);
      }
    }
    return null;
  }

  async listWaitingByRequester(
    requesterId: MemberId,
  ): Promise<readonly HouseholdJoinRequest[]> {
    return [...this.store.values()]
      .filter(
        (state) =>
          state.requesterId === requesterId &&
          (state.status === "pending" || state.status === "declined"),
      )
      .map((state) => HouseholdJoinRequest.rehydrate(state));
  }

  async save(request: HouseholdJoinRequest): Promise<void> {
    this.store.set(request.id, request.toState());
  }
}

export class SequentialHouseholdIdGenerator implements HouseholdIdGenerator {
  private counter = 0;

  next(): HouseholdId {
    this.counter += 1;
    return toHouseholdId(`household-${this.counter}`);
  }
}

export class SequentialHouseholdInviteIdGenerator implements HouseholdInviteIdGenerator {
  private counter = 0;

  next(): HouseholdInviteId {
    this.counter += 1;
    return toHouseholdInviteId(`household-invite-${this.counter}`);
  }
}

export class SequentialHouseholdJoinRequestIdGenerator implements HouseholdJoinRequestIdGenerator {
  private counter = 0;

  next(): HouseholdJoinRequestId {
    this.counter += 1;
    return toHouseholdJoinRequestId(`household-join-request-${this.counter}`);
  }
}

export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return this.instant;
  }

  // Move the clock (e.g. past a request's lapse).
  set(instant: Date): void {
    this.instant = instant;
  }
}

export class RecordingEventPublisher implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
  }

  names(): string[] {
    return this.published.map((e) => e.name);
  }
}
