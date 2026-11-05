import {
  ExchangeActionCommand,
  ExchangeActionResult,
} from "./exchange-action.command";

// Inbound port: the initiator cancels a proposed or accepted exchange; the recipient an accepted one.
export interface CancelExchange {
  (cmd: ExchangeActionCommand): Promise<ExchangeActionResult>;
}
