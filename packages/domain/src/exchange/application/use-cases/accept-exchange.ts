import { ExchangeState } from "../../domain";
import { ApplicationError } from "../errors";
import { AcceptExchange } from "../ports/in/accept-exchange.port";
import { CopyPort } from "../ports/out/copy.port";
import { ExchangeEligibilityPort } from "../ports/out/exchange-eligibility.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";
import { settlementGuard } from "./settlement-guard";

export interface AcceptExchangeDeps extends ExchangeActionDeps {
  readonly eligibility: ExchangeEligibilityPort;
  readonly copies: CopyPort;
}

// The recipient accepts. Only the initiator's own circle standing is checked again, and only when
// the request rested on it: what the owner changed since (profile, follows, household) never stops
// them accepting a request they received. Confirm, cancel, decline and dispute don't re-check it, so
// a trade already under way can finish. Separately, accept (after eligibility) and confirm refuse
// once a copy the deal names is no longer where the deal found it (settlement-guard): such a deal
// could never settle.
export const makeAcceptExchange = (deps: AcceptExchangeDeps): AcceptExchange =>
  runExchangeAction(
    deps,
    (exchange, by, now) => exchange.accept(by, now),
    async (exchange) => {
      const state = exchange.toState();
      if (!(await stillEligible(deps.eligibility, state))) {
        return ApplicationError.notPermittedInCircle(state.requestedCopyId);
      }
      return settlementGuard(deps.copies)(exchange);
    },
  );

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
