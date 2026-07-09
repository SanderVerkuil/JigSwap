import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CatalogApplicationError } from "../errors";
import {
  DecideChangeProposalResult,
  RejectChangeProposal,
  RejectChangeProposalCommand,
} from "../ports/in/decide-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";

export interface RejectChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Load → reject (aggregate owns the pending-only rule + stores the reason) → save → publish.
// The definition is never touched on a rejection.
export const makeRejectChangeProposal =
  (deps: RejectChangeProposalDeps): RejectChangeProposal =>
  async (
    cmd: RejectChangeProposalCommand,
  ): Promise<DecideChangeProposalResult> => {
    const proposal = await deps.proposals.findById(cmd.changeProposalId);
    if (!proposal) {
      return err(
        CatalogApplicationError.changeProposalNotFound(cmd.changeProposalId),
      );
    }

    const outcome = proposal.reject(cmd.reason, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.proposals.save(proposal);
    await deps.events.publish(proposal.pullEvents());
    return ok(undefined);
  };
