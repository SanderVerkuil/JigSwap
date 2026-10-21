import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import {
  CopyId,
  Exchange,
  ExchangeError,
  ExchangeId,
  ExchangeKind,
  MemberId,
} from "../../domain";
import { ApplicationError } from "../errors";
import {
  ProposeExchange,
  ProposeExchangeCommand,
} from "../ports/in/propose-exchange.port";
import { CopyPort, CopyView } from "../ports/out/copy.port";
import { ExchangeEligibilityPort } from "../ports/out/exchange-eligibility.port";
import { ExchangeIdGenerator } from "../ports/out/exchange-id-generator";
import { ExchangeRepository } from "../ports/out/exchange.repository";

export interface ProposeExchangeDeps {
  readonly exchanges: ExchangeRepository;
  readonly copies: CopyPort;
  readonly eligibility: ExchangeEligibilityPort;
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

// Transaction script: cross-aggregate read checks (dedup, copy existence/availability/ownership,
// the initiator's exchange eligibility, recorded as `eligibleVia`)
// then delegate the entity rules (self-exchange, term validity, state) to Exchange.propose.
// Copy reservation/locking is a Phase-2 (Library) concern and is intentionally not done here.
export const makeProposeExchange =
  (deps: ProposeExchangeDeps): ProposeExchange =>
  async (
    cmd: ProposeExchangeCommand,
  ): Promise<Result<ExchangeId, ExchangeError | ApplicationError>> => {
    const duplicate = await deps.exchanges.findActiveProposal(
      cmd.initiatorId,
      cmd.requestedCopyId,
    );
    if (duplicate)
      return err(ApplicationError.duplicateProposal(cmd.requestedCopyId));

    const requested = await deps.copies.getCopy(cmd.requestedCopyId);
    if (!requested)
      return err(ApplicationError.copyNotFound(cmd.requestedCopyId));
    if (!availableFor(requested, cmd.kind)) {
      return err(
        ApplicationError.copyNotAvailable(cmd.requestedCopyId, cmd.kind),
      );
    }
    // The recipient must actually own the requested copy, else the proposal targets an arbitrary
    // member (spam) and could never settle.
    if (requested.ownerId !== cmd.recipientId) {
      return err(ApplicationError.recipientNotOwner(cmd.requestedCopyId));
    }

    if (cmd.kind === "swap") {
      const offered = await loadOfferedCopy(deps.copies, cmd);
      if (offered.isErr) return offered;
    }

    // The initiator's own permission counts: a route that only runs through ViewOnly circle seats
    // lets them see the copy but not ask for it. The kind of route is recorded so accept re-checks
    // only what the request rested on. Refused after the entity rules, so a self-exchange or bad
    // terms keep their own errors.
    const eligibleVia = await deps.eligibility.eligibleVia(
      cmd.initiatorId,
      cmd.requestedCopyId,
    );

    const exchange = Exchange.propose({
      id: deps.ids.next(),
      initiator: cmd.initiatorId,
      recipient: cmd.recipientId,
      requestedCopyId: cmd.requestedCopyId,
      terms: cmd.terms,
      eligibleVia: eligibleVia ?? undefined,
      now: deps.clock.now(),
    });
    if (exchange.isErr) return err(exchange.error);
    if (eligibleVia === null) {
      return err(ApplicationError.notPermittedInCircle(cmd.requestedCopyId));
    }

    await deps.exchanges.save(exchange.value);
    await deps.events.publish(exchange.value.pullEvents());
    return ok(exchange.value.id);
  };

// The swap offer rule, shared with the read side that lists a requester's offerable copies: the
// initiator may offer a copy they own or co-manage through their household — but never the
// recipient's own copy (a co-manager "swapping" the owner's copy with the owner).
export const mayOfferCopy = (
  offered: CopyView,
  initiatorId: MemberId,
  recipientId: MemberId,
): boolean =>
  (offered.ownerId === initiatorId ||
    (offered.coManagerIds ?? []).includes(initiatorId)) &&
  offered.ownerId !== recipientId;

// For a swap the offered copy must exist and be owned (or household-co-managed) by the initiator
// (the offered copy id lives in the kind-tagged terms).
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
  if (!mayOfferCopy(offered, cmd.initiatorId, cmd.recipientId)) {
    return err(ApplicationError.offeredCopyNotOwned(offeredCopyId));
  }
  return ok(undefined);
};
