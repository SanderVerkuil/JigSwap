import { Follow, MemberId } from "../../../domain";

// Outbound port: persistence for Follow edges. The 1b-convex adapter implements this over
// `ctx.db` (the `follows` table) behind a mapper; the domain never sees a row.
export interface FollowRepository {
  // Backs the pair-uniqueness rule: at most one edge per (follower, followee). Returns the
  // existing edge if this follower already follows this followee, else null.
  find(followerId: MemberId, followeeId: MemberId): Promise<Follow | null>;
  save(follow: Follow): Promise<void>;
  remove(follow: Follow): Promise<void>;
  // The members this follower follows; supports feed fan-out and reads.
  listFollowees(memberId: MemberId): Promise<readonly MemberId[]>;
}
