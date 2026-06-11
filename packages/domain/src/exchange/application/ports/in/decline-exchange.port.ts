import {
  ExchangeActionCommand,
  ExchangeActionResult,
} from "./exchange-action.command";

// Inbound port: the recipient declines a proposed exchange.
export interface DeclineExchange {
  (cmd: ExchangeActionCommand): Promise<ExchangeActionResult>;
}
