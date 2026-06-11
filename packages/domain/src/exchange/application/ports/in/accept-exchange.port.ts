import {
  ExchangeActionCommand,
  ExchangeActionResult,
} from "./exchange-action.command";

// Inbound port: the recipient accepts a proposed exchange.
export interface AcceptExchange {
  (cmd: ExchangeActionCommand): Promise<ExchangeActionResult>;
}
