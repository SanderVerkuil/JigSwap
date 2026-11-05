import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CatalogApplicationError } from "../errors";
import {
  ApproveChangeProposal,
  ApproveChangeProposalCommand,
  DecideChangeProposalResult,
} from "../ports/in/decide-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";
import { firstDuplicateBarcode } from "./barcode-uniqueness";

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
    // Approve only the version the admin reviewed: a proposer's edit after that moment (the
    // review page is live, but the click can race it) must be looked at again, not applied.
    if (
      cmd.expectedUpdatedAt !== undefined &&
      proposal.updatedAt.getTime() !== cmd.expectedUpdatedAt.getTime()
    ) {
      return err(
        CatalogApplicationError.changeProposalChanged(cmd.changeProposalId),
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

    // The barcode-uniqueness rule, as on submit and update: the patch may not give this
    // definition a barcode another definition holds (its own barcodes are no clash).
    const duplicate = await firstDuplicateBarcode(
      deps.definitions,
      proposal.changes.barcodes,
      proposal.puzzleDefinitionId,
    );
    if (duplicate)
      return err(CatalogApplicationError.duplicateBarcode(duplicate));

    const applied = definition.update(proposal.changes, now);
    if (applied.isErr) return err(applied.error);

    await deps.proposals.save(proposal);
    await deps.definitions.save(definition);
    await deps.events.publish(proposal.pullEvents());
    await deps.events.publish(definition.pullEvents());
    return ok(undefined);
  };
