import { CopyId, EligibleVia, MemberId } from "../../../domain";

// Outbound port: may this member ask for an exchange on this copy? The adapter resolves the routes
// the member has to the copy (public profile with an open copy, household, mutual follow, circles
// holding the share) and applies Sharing's rule: a ViewOnly circle seat on its own does not allow a
// request.
export interface ExchangeEligibilityPort {
  // On propose: which kind of route allows the request, or null when none does.
  eligibleVia(memberId: MemberId, copyId: CopyId): Promise<EligibleVia | null>;
  // On accept: does the member still hold an Exchange or Admin seat in a circle that holds the
  // share (both current members)? Only the circle side counts; the owner's profile, follows,
  // household and the copy's availability are not looked at.
  holdsCircleExchangeSeat(memberId: MemberId, copyId: CopyId): Promise<boolean>;
}
