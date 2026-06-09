import { Member, MemberId } from "../../domain";
import { MemberRepository } from "../ports/out/member.repository";

// In-memory MemberRepository for use-case tests, keyed by member id. Stores persisted state and
// rehydrates a fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryMemberRepository implements MemberRepository {
  private readonly store = new Map<MemberId, ReturnType<Member["toState"]>>();

  async findByClerkId(clerkId: string): Promise<Member | null> {
    for (const state of this.store.values()) {
      if (state.clerkId === clerkId) return Member.rehydrate(state);
    }
    return null;
  }

  async findById(memberId: MemberId): Promise<Member | null> {
    const state = this.store.get(memberId);
    return state ? Member.rehydrate(state) : null;
  }

  async save(member: Member): Promise<void> {
    this.store.set(member.id, member.toState());
  }

  // Test helper: how many members are currently stored.
  size(): number {
    return this.store.size;
  }
}
