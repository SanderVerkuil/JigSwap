import { MemberId } from "../../../domain";

// Outbound port: who an Admin may invite into a circle. The backend adapter answers it from the
// social graph and the block list; the domain only asks.
export interface InvitePolicy {
  // The contact rule: not blocked either way, AND a mutual follow or an existing pair thread.
  // Deliberately NOT "shares a circle" (that would let circles chain-invite strangers).
  canInvite(actor: MemberId, invitee: MemberId): Promise<boolean>;
  // Either member has blocked the other. Re-checked when an invite is accepted.
  isBlockedEitherWay(a: MemberId, b: MemberId): Promise<boolean>;
}
