import { RaiseDispute } from "../ports/in/raise-dispute.port";
import { ExchangeActionDeps, runExchangeAction } from "./run-exchange-action";

export const makeRaiseDispute = (deps: ExchangeActionDeps): RaiseDispute =>
  runExchangeAction(deps, (exchange, by, now) =>
    exchange.raiseDispute(by, now),
  );
