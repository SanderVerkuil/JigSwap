import { DeclineExchange } from "../ports/in/decline-exchange.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";

export const makeDeclineExchange = (
  deps: ExchangeActionDeps,
): DeclineExchange =>
  runExchangeAction(deps, (exchange, by, now) => exchange.decline(by, now));
