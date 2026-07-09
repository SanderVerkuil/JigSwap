import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CatalogApplicationError } from "../errors";
import {
  ApproveChangeProposal,
  ApproveChangeProposalCommand,
  DecideChangeProposalResult,
} from "../ports/in/decide-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";

export interface ApproveChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly definitions: PuzzleDefinitionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// The one same-context orchestration in Catalog: the admin's click means "approve AND apply"
// atomically, so this use case sequences BOTH aggregates inside one transaction — no event
// choreography between them (that is reserved for cross-context integration). Every failure
// path returns BEFORE any save, so a failed approval leaves both aggregates untouched.
export const makeApproveChangeProposal =
  (deps: ApproveChangeProposalDeps): ApproveChangeProposal =>
  async (
    cmd: ApproveChangeProposalCommand,
  ): Promise<DecideChangeProposalResult> => {
    const proposal = await deps.proposals.findById(cmd.changeProposalId);
    if (!proposal) {
      return err(
        CatalogApplicationError.changeProposalNotFound(cmd.changeProposalId),
      );
    }

    const definition = await deps.definitions.findById(
      proposal.puzzleDefinitionId,
    );
    if (!definition) {
      return err(
        CatalogApplicationError.puzzleDefinitionNotFound(
          proposal.puzzleDefinitionId,
        ),
      );
    }

    const now = deps.clock.now();
    const approved = proposal.approve(now);
    if (approved.isErr) return err(approved.error);

    const applied = definition.update(proposal.changes, now);
    if (applied.isErr) return err(applied.error);

    await deps.proposals.save(proposal);
    await deps.definitions.save(definition);
    await deps.events.publish(proposal.pullEvents());
    await deps.events.publish(definition.pullEvents());
    return ok(undefined);
  };
