import { ExchangeActionCommand, ExchangeActionResult } from "./exchange-action.command";

// Inbound port: the initiator cancels a proposed or accepted exchange.
export interface CancelExchange {
  (cmd: ExchangeActionCommand): Promise<ExchangeActionResult>;
}
