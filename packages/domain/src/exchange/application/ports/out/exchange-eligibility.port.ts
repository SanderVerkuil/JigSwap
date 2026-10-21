import { CopyId, MemberId } from "../../../domain";

// Outbound port: may this member ask for an exchange on this copy? The adapter resolves the routes
// the member has to the copy (public profile with an open copy, household, mutual follow, circles
// holding the share) and applies Sharing's `mayExchangeVia`: a ViewOnly circle seat on its own does
// not allow a request. Asked on propose and again on accept, so a downgrade in between blocks it.
export interface ExchangeEligibilityPort {
  mayExchange(memberId: MemberId, copyId: CopyId): Promise<boolean>;
}
