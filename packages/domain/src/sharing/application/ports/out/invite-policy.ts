import { MemberId } from "../../../domain";

// Outbound port: who an Admin may invite into a circle. The backend adapter answers it from the
// social graph and the block list; the domain only asks.
export interface InvitePolicy {
  // The contact rule: not blocked either way, AND a mutual follow. Deliberately NOT "shares a
  // circle" or "has a thread": both can come about without the invitee's consent.
  canInvite(actor: MemberId, invitee: MemberId): Promise<boolean>;
  // Either member has blocked the other. Re-checked when an invite is accepted.
  isBlockedEitherWay(a: MemberId, b: MemberId): Promise<boolean>;
}
