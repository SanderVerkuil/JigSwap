import { Result } from "../../../../shared-kernel";
import { ExchangeError } from "../../../domain";
import { ExchangeId, MemberId } from "../../../domain";
import { ApplicationError } from "../../errors";

// Every state-transition use case (accept/decline/cancel/confirm/dispute) acts on an existing
// exchange on behalf of an authenticated member. `now` is supplied by the Clock port, not the
// command, so commands are deterministic. The aggregate enforces party-auth + legal transitions.
export interface ExchangeActionCommand {
  readonly exchangeId: ExchangeId;
  readonly actingMemberId: MemberId;
}

// Shared inbound-port signature for the lifecycle use cases: succeed with nothing, or fail
// with an aggregate error (wrong party, illegal transition) or ExchangeNotFound.
export type ExchangeActionResult = Result<void, ExchangeError | ApplicationError>;
