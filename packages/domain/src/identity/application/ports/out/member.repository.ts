import { Member, MemberId } from "../../../domain";

// Outbound port: persistence for the Member aggregate. The convex adapter implements this over
// `ctx.db` (the `users` table) behind a mapper; the domain never sees a row. `findByClerkId`
// backs the one-Member-per-Clerk-subject rule (RegisterMember idempotency); it returns null for
// a never-registered subject.
export interface MemberRepository {
  findByClerkId(clerkId: string): Promise<Member | null>;
  findById(memberId: MemberId): Promise<Member | null>;
  save(member: Member): Promise<void>;
}
