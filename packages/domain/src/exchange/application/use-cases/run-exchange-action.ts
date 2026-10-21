import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { Exchange, ExchangeError, MemberId } from "../../domain";
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

// A check that needs the world outside the aggregate, run after the transition succeeded in memory
// and before anything is saved, so a refusal leaves the stored exchange untouched.
type ActionGuard = (exchange: Exchange) => Promise<ApplicationError | null>;

// Shared transaction script for the lifecycle use cases: load (→ ExchangeNotFound), invoke
// the aggregate method (it owns party-auth + legal transitions), run the optional guard, persist,
// publish.
export const runExchangeAction =
  (deps: ExchangeActionDeps, action: AggregateAction, guard?: ActionGuard) =>
  async (
    cmd: ExchangeActionCommand,
  ): Promise<Result<void, ExchangeError | ApplicationError>> => {
    const exchange = await deps.exchanges.findById(cmd.exchangeId);
    if (!exchange)
      return err(ApplicationError.exchangeNotFound(cmd.exchangeId));

    const outcome = action(exchange, cmd.actingMemberId, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);
    const refused = guard ? await guard(exchange) : null;
    if (refused) return err(refused);

    await deps.exchanges.save(exchange);
    await deps.events.publish(exchange.pullEvents());
    return ok(undefined);
  };
