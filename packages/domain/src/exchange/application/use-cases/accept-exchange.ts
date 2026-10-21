import { ExchangeState } from "../../domain";
import { ApplicationError } from "../errors";
import { AcceptExchange } from "../ports/in/accept-exchange.port";
import { ExchangeEligibilityPort } from "../ports/out/exchange-eligibility.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";

export interface AcceptExchangeDeps extends ExchangeActionDeps {
  readonly eligibility: ExchangeEligibilityPort;
}

// The recipient accepts. Only the initiator's own circle standing is checked again, and only when
// the request rested on it: what the owner changed since (profile, follows, household) never stops
// them accepting a request they received. Confirm, cancel, decline and dispute are not re-checked,
// so a trade already under way can finish.
export const makeAcceptExchange = (deps: AcceptExchangeDeps): AcceptExchange =>
  runExchangeAction(
    deps,
    (exchange, by, now) => exchange.accept(by, now),
    async (exchange) => {
      const state = exchange.toState();
      return (await stillEligible(deps.eligibility, state))
        ? null
        : ApplicationError.notPermittedInCircle(state.requestedCopyId);
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
