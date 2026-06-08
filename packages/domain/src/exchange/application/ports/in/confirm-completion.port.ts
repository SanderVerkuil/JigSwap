import { ExchangeActionCommand, ExchangeActionResult } from "./exchange-action.command";

// Inbound port: a party confirms completion. Settlement happens only once both have confirmed
// (dual-confirmation invariant owned by the aggregate).
export interface ConfirmCompletion {
  (cmd: ExchangeActionCommand): Promise<ExchangeActionResult>;
}
