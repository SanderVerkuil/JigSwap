import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Exchange, ExchangeError, MemberId } from "../../domain";
import { Result } from "../../../shared-kernel";
import { ApplicationError } from "../errors";
import { ExchangeActionCommand } from "../ports/in/exchange-action.command";
import { ExchangeRepository } from "../ports/out/exchange.repository";

export interface ExchangeActionDeps {
  readonly exchanges: ExchangeRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// An aggregate state-transition method (accept/decline/cancel/confirm/dispute) — they all
// share the (actingMember, now) → Result shape.
type AggregateAction = (
  exchange: Exchange,
  by: MemberId,
  now: Date,
) => Result<void, ExchangeError>;

// Shared transaction script for the lifecycle use cases: load (→ ExchangeNotFound), invoke
// the aggregate method (it owns party-auth + legal transitions), persist, publish.
export const runExchangeAction =
  (deps: ExchangeActionDeps, action: AggregateAction) =>
  async (
    cmd: ExchangeActionCommand,
  ): Promise<Result<void, ExchangeError | ApplicationError>> => {
    const exchange = await deps.exchanges.findById(cmd.exchangeId);
    if (!exchange) return err(ApplicationError.exchangeNotFound(cmd.exchangeId));

    const outcome = action(exchange, cmd.actingMemberId, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.exchanges.save(exchange);
    await deps.events.publish(exchange.pullEvents());
    return ok(undefined);
  };
