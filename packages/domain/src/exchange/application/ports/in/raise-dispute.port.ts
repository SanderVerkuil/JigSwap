import {
  ExchangeActionCommand,
  ExchangeActionResult,
} from "./exchange-action.command";

// Inbound port: either party flags a problem with an accepted or completed exchange.
export interface RaiseDispute {
  (cmd: ExchangeActionCommand): Promise<ExchangeActionResult>;
}
