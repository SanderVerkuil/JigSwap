import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { CopyId, Exchange, ExchangeError, ExchangeId, ExchangeKind } from "../../domain";
import { ApplicationError } from "../errors";
import { ProposeExchange, ProposeExchangeCommand } from "../ports/in/propose-exchange.port";
import { CopyPort, CopyView } from "../ports/out/copy.port";
import { ExchangeIdGenerator } from "../ports/out/exchange-id-generator";
import { ExchangeRepository } from "../ports/out/exchange.repository";

export interface ProposeExchangeDeps {
  readonly exchanges: ExchangeRepository;
  readonly copies: CopyPort;
  readonly ids: ExchangeIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Is the copy offered for this kind? swap⇒forTrade, sale⇒forSale, lend⇒forLend.
const availableFor = (copy: CopyView, kind: ExchangeKind): boolean => {
  switch (kind) {
    case "swap":
      return copy.availability.forTrade;
    case "sale":
      return copy.availability.forSale;
    case "lend":
      return copy.availability.forLend;
  }
};

// Transaction script: cross-aggregate read checks (dedup, copy existence/availability/ownership)
// then delegate the entity rules (self-exchange, term validity, state) to Exchange.propose.
// Copy reservation/locking is a Phase-2 (Library) concern and is intentionally not done here.
export const makeProposeExchange =
  (deps: ProposeExchangeDeps): ProposeExchange =>
  async (cmd: ProposeExchangeCommand): Promise<Result<ExchangeId, ExchangeError | ApplicationError>> => {
    const duplicate = await deps.exchanges.findActiveProposal(
      cmd.initiatorId,
      cmd.requestedCopyId,
    );
    if (duplicate) return err(ApplicationError.duplicateProposal(cmd.requestedCopyId));

    const requested = await deps.copies.getCopy(cmd.requestedCopyId);
    if (!requested) return err(ApplicationError.copyNotFound(cmd.requestedCopyId));
    if (!availableFor(requested, cmd.kind)) {
      return err(ApplicationError.copyNotAvailable(cmd.requestedCopyId, cmd.kind));
    }

    if (cmd.kind === "swap") {
      const offered = await loadOfferedCopy(deps.copies, cmd);
      if (offered.isErr) return offered;
    }

    const exchange = Exchange.propose({
      id: deps.ids.next(),
      initiator: cmd.initiatorId,
      recipient: cmd.recipientId,
      requestedCopyId: cmd.requestedCopyId,
      terms: cmd.terms,
      now: deps.clock.now(),
    });
    if (exchange.isErr) return err(exchange.error);

    await deps.exchanges.save(exchange.value);
    await deps.events.publish(exchange.value.pullEvents());
    return ok(exchange.value.id);
  };

// For a swap the offered copy must exist and be owned by the initiator (the offered copy id
// lives in the kind-tagged terms).
const loadOfferedCopy = async (
  copies: CopyPort,
  cmd: ProposeExchangeCommand,
): Promise<Result<void, ApplicationError>> => {
  const offeredCopyId: CopyId | undefined =
    cmd.terms.kind === "swap" ? cmd.terms.offeredCopyId : undefined;
  // No offered copy: defer to Exchange.propose, which rejects swap terms without one (MissingTerms).
  if (!offeredCopyId) return ok(undefined);

  const offered = await copies.getCopy(offeredCopyId);
  if (!offered) return err(ApplicationError.copyNotFound(offeredCopyId));
  if (offered.ownerId !== cmd.initiatorId) {
    return err(ApplicationError.offeredCopyNotOwned(offeredCopyId));
  }
  return ok(undefined);
};
