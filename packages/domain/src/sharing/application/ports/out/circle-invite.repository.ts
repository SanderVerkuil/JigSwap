import {
  CircleId,
  CircleInvite,
  CircleInviteId,
  MemberId,
} from "../../../domain";

// Outbound port: persistence for CircleInvite aggregates. "Pending" here is the stored status;
// whether a pending invite is still open (not past its expiresAt) is the aggregate's call.
export interface CircleInviteRepository {
  findById(id: CircleInviteId): Promise<CircleInvite | null>;
  // The stored-pending invite for this (circle, invitee), if any (at most one by construction).
  findPending(
    circleId: CircleId,
    inviteeId: MemberId,
  ): Promise<CircleInvite | null>;
  // Every invite ever sent to this (circle, invitee), any status, for the re-invite cooldown.
  listForInvitee(
    circleId: CircleId,
    inviteeId: MemberId,
  ): Promise<readonly CircleInvite[]>;
  // Every stored-pending invite to the circle, for the member cap.
  listPendingForCircle(circleId: CircleId): Promise<readonly CircleInvite[]>;
  save(invite: CircleInvite): Promise<void>;
}

export interface CircleInviteIdGenerator {
  next(): CircleInviteId;
}
