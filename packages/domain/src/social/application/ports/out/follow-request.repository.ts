import { FollowRequest, FollowRequestId, MemberId } from "../../../domain";

// Outbound port: persistence for FollowRequest aggregates. The 1b-convex adapter implements
// this over `ctx.db` (the `followRequests` table) behind a mapper; the domain never sees a row.
export interface FollowRequestRepository {
  // Backs pair-uniqueness and the cooldown rule: the most recent request for this
  // (requester, target) pair regardless of status, else null.
  findByPair(
    requesterId: MemberId,
    targetId: MemberId,
  ): Promise<FollowRequest | null>;
  findById(id: FollowRequestId): Promise<FollowRequest | null>;
  save(request: FollowRequest): Promise<void>;
  remove(request: FollowRequest): Promise<void>;
}
