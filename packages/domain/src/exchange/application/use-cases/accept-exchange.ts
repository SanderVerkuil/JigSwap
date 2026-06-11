import { AcceptExchange } from "../ports/in/accept-exchange.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";

export const makeAcceptExchange = (deps: ExchangeActionDeps): AcceptExchange =>
  runExchangeAction(deps, (exchange, by, now) => exchange.accept(by, now));
