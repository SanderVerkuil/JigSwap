import { toCircleInviteId } from "../../../shared-kernel";
import { CircleId, CircleInvite, CircleInviteId, MemberId } from "../../domain";
import {
  CircleInviteIdGenerator,
  CircleInviteRepository,
} from "../ports/out/circle-invite.repository";
import { InvitePolicy } from "../ports/out/invite-policy";

// In-memory CircleInviteRepository for use-case tests: stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the adapter round-trip.
export class InMemoryCircleInviteRepository implements CircleInviteRepository {
  private readonly store = new Map<
    CircleInviteId,
    ReturnType<CircleInvite["toState"]>
  >();

  async findById(id: CircleInviteId): Promise<CircleInvite | null> {
    const state = this.store.get(id);
    return state ? CircleInvite.rehydrate(state) : null;
  }

  async findPending(
    circleId: CircleId,
    inviteeId: MemberId,
  ): Promise<CircleInvite | null> {
    const pending = await this.listPendingForCircle(circleId);
    return pending.find((invite) => invite.inviteeId === inviteeId) ?? null;
  }

  async listForInvitee(
    circleId: CircleId,
    inviteeId: MemberId,
  ): Promise<readonly CircleInvite[]> {
    return [...this.store.values()]
      .filter(
        (state) => state.circleId === circleId && state.inviteeId === inviteeId,
      )
      .map((state) => CircleInvite.rehydrate(state));
  }

  async listPendingForCircle(
    circleId: CircleId,
  ): Promise<readonly CircleInvite[]> {
    return [...this.store.values()]
      .filter(
        (state) => state.circleId === circleId && state.status === "pending",
      )
      .map((state) => CircleInvite.rehydrate(state));
  }

  async save(invite: CircleInvite): Promise<void> {
    this.store.set(invite.id, invite.toState());
  }

  // Test helper: every stored invite's state.
  all(): ReturnType<CircleInvite["toState"]>[] {
    return [...this.store.values()];
  }
}

// Deterministic CircleInviteIdGenerator for tests: circle-invite-1, circle-invite-2, ...
export class SequentialCircleInviteIdGenerator implements CircleInviteIdGenerator {
  private counter = 0;

  next(): CircleInviteId {
    this.counter += 1;
    return toCircleInviteId(`circle-invite-${this.counter}`);
  }
}

// A configurable InvitePolicy: contactable pairs and blocked pairs are listed explicitly (both
// directions are treated alike).
export class StubInvitePolicy implements InvitePolicy {
  private readonly contacts = new Set<string>();
  private readonly blocks = new Set<string>();

  private static key(a: MemberId, b: MemberId): string {
    return [a, b].sort().join("|");
  }

  allowContact(a: MemberId, b: MemberId): void {
    this.contacts.add(StubInvitePolicy.key(a, b));
  }

  block(a: MemberId, b: MemberId): void {
    this.blocks.add(StubInvitePolicy.key(a, b));
  }

  async canInvite(actor: MemberId, invitee: MemberId): Promise<boolean> {
    return (
      !(await this.isBlockedEitherWay(actor, invitee)) &&
      this.contacts.has(StubInvitePolicy.key(actor, invitee))
    );
  }

  async isBlockedEitherWay(a: MemberId, b: MemberId): Promise<boolean> {
    return this.blocks.has(StubInvitePolicy.key(a, b));
  }
}
