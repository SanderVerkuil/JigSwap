import { CopyId, ExchangeState } from "../../domain";
import { ApplicationError } from "../errors";
import { AcceptExchange } from "../ports/in/accept-exchange.port";
import { CopyPort } from "../ports/out/copy.port";
import { ExchangeEligibilityPort } from "../ports/out/exchange-eligibility.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";
import { canStillSettle, settlementGuard } from "./settlement-guard";

export interface AcceptExchangeDeps extends ExchangeActionDeps {
  readonly eligibility: ExchangeEligibilityPort;
  readonly copies: CopyPort;
}

// The recipient accepts. Only the initiator's own circle standing is checked again, and only when
// the request rested on it: what the owner changed since (profile, follows, household) never stops
// them accepting a request they received. Confirm, cancel, decline and dispute don't re-check it, so
// a trade already under way can finish. Separately, accept (after eligibility) and confirm refuse
// once a copy the deal names is no longer where the deal found it (settlement-guard): such a deal
// could never settle. Last, accepting sets the deal's copies aside for it: it is refused while either
// copy is set aside for another accepted deal (reservedElsewhere).
export const makeAcceptExchange = (deps: AcceptExchangeDeps): AcceptExchange =>
  runExchangeAction(
    deps,
    (exchange, by, now) => exchange.accept(by, now),
    async (exchange) => {
      const state = exchange.toState();
      if (!(await stillEligible(deps.eligibility, state))) {
        return ApplicationError.notPermittedInCircle(state.requestedCopyId);
      }
      return (
        (await settlementGuard(deps.copies)(exchange)) ??
        (await reservedElsewhere(deps, state))
      );
    },
  );

// One copy, one deal: a copy the deal would move (the requested one; a swap's offered one) is set
// aside while another ACCEPTED exchange naming it could still settle (canStillSettle). Proposals set
// nothing aside, so several members may still ask for the same copy, and an accepted deal that can
// no longer settle (a copy changed hands, the offered copy can't be offered any more) never holds a
// copy against a new deal. The exchange being accepted is still stored as proposed, so it never
// counts against itself. Concurrent accepts on one copy both read the exchanges naming it and each
// writes one of them, so the store serialises them and the later one sees the earlier.
const reservedElsewhere = async (
  deps: AcceptExchangeDeps,
  state: ExchangeState,
): Promise<ApplicationError | null> => {
  const stillSettles = canStillSettle(deps.copies);
  for (const copyId of copiesMovedBy(state)) {
    for (const other of await deps.exchanges.findReferencing(copyId)) {
      if (other.status === "accepted" && (await stillSettles(other))) {
        return ApplicationError.copyReserved(copyId);
      }
    }
  }
  return null;
};

// The copies settlement would move, as Exchange.settle does: the requested copy, plus a swap's
// offered copy.
const copiesMovedBy = (state: ExchangeState): readonly CopyId[] =>
  state.kind === "swap" && state.offeredCopyId
    ? [state.requestedCopyId, state.offeredCopyId]
    : [state.requestedCopyId];

//   direct — a route through the owner allowed it at propose time: nothing to re-check.
//   circle — only circle seats did: the initiator must still hold Exchange or Admin in a circle that
//            holds the share (a demotion to ViewOnly or leaving the circle refuses).
//   absent — proposed before this was recorded: a route through the owner now is enough, else the
//            circle check.
const stillEligible = async (
  eligibility: ExchangeEligibilityPort,
  { initiatorId, requestedCopyId, eligibleVia }: ExchangeState,
): Promise<boolean> => {
  if (eligibleVia === "direct") return true;
  if (
    eligibleVia === undefined &&
    (await eligibility.eligibleVia(initiatorId, requestedCopyId)) === "direct"
  ) {
    return true;
  }
  return eligibility.holdsCircleExchangeSeat(initiatorId, requestedCopyId);
};
