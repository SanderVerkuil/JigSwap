import { ApplicationError } from "../errors";
import { AcceptExchange } from "../ports/in/accept-exchange.port";
import { ExchangeEligibilityPort } from "../ports/out/exchange-eligibility.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";

export interface AcceptExchangeDeps extends ExchangeActionDeps {
  readonly eligibility: ExchangeEligibilityPort;
}

// The recipient accepts. The initiator's eligibility is checked again here: their circle level may
// have dropped to ViewOnly since they proposed. Only accept is re-checked; confirm, cancel, decline
// and dispute stay open so a trade already under way can finish.
export const makeAcceptExchange = (deps: AcceptExchangeDeps): AcceptExchange =>
  runExchangeAction(
    deps,
    (exchange, by, now) => exchange.accept(by, now),
    async (exchange) => {
      const { initiatorId, requestedCopyId } = exchange.toState();
      return (await deps.eligibility.mayExchange(initiatorId, requestedCopyId))
        ? null
        : ApplicationError.notPermittedInCircle(requestedCopyId);
    },
  );
