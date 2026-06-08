import { ConfirmCompletion } from "../ports/in/confirm-completion.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";

export const makeConfirmCompletion = (deps: ExchangeActionDeps): ConfirmCompletion =>
  runExchangeAction(deps, (exchange, by, now) => exchange.confirmCompletion(by, now));
