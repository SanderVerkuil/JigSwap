import { CancelExchange } from "../ports/in/cancel-exchange.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";

export const makeCancelExchange = (deps: ExchangeActionDeps): CancelExchange =>
  runExchangeAction(deps, (exchange, by, now) => exchange.cancel(by, now));
