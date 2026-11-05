import { ConfirmCompletion } from "../ports/in/confirm-completion.port";
import { CopyPort } from "../ports/out/copy.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";
import { settlementGuard } from "./settlement-guard";

export interface ConfirmCompletionDeps extends ExchangeActionDeps {
  readonly copies: CopyPort;
}

// A party confirms; the exchange settles once both have. Every confirmation is refused, and nothing
// is saved, once a copy the deal names is no longer where the deal found it (settlement-guard): a
// stale exchange can never settle, so it never moves a copy away from someone it wasn't made with.
// Nor does a deal settle while a copy it moves is out on loan (CopyReserved) until it is back.
export const makeConfirmCompletion = (
  deps: ConfirmCompletionDeps,
): ConfirmCompletion =>
  runExchangeAction(
    deps,
    (exchange, by, now) => exchange.confirmCompletion(by, now),
    settlementGuard(deps.copies),
  );
