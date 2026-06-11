import { Completion, CompletionId, MemberId } from "../../../domain";

// Outbound port: persistence for the Completion aggregate. The 2c-convex adapter implements this
// over `ctx.db` (the `completions` table) behind a mapper; the domain never sees a row.
export interface CompletionRepository {
  findById(id: CompletionId): Promise<Completion | null>;
  save(completion: Completion): Promise<void>;
  listByUser(userId: MemberId): Promise<readonly Completion[]>;
  // The authoritative count of a member's recorded (finished) completions. Drives the DERIVED
  // goal progress so the count is never hand-set on a Goal.
  countCompletedByUser(userId: MemberId): Promise<number>;
}
