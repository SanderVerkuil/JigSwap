import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { CatalogError } from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  WithdrawChangeProposal,
  WithdrawChangeProposalCommand,
} from "../ports/in/withdraw-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";

export interface WithdrawChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Load → withdraw (aggregate owns the pending-only rule) → save → publish.
export const makeWithdrawChangeProposal =
  (deps: WithdrawChangeProposalDeps): WithdrawChangeProposal =>
  async (
    cmd: WithdrawChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>> => {
    const proposal = await deps.proposals.findById(cmd.changeProposalId);
    if (!proposal) {
      return err(
        CatalogApplicationError.changeProposalNotFound(cmd.changeProposalId),
      );
    }

    const outcome = proposal.withdraw(deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.proposals.save(proposal);
    await deps.events.publish(proposal.pullEvents());
    return ok(undefined);
  };
