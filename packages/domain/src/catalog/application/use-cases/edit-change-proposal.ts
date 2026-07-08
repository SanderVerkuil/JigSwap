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
  EditChangeProposal,
  EditChangeProposalCommand,
} from "../ports/in/edit-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";
import { baselineFor } from "./proposal-baseline";

export interface EditChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly definitions: PuzzleDefinitionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Load proposal + its target definition (for a FRESH baseline), delegate the pending-only and
// diff-validity rules to the aggregate, save, publish.
export const makeEditChangeProposal =
  (deps: EditChangeProposalDeps): EditChangeProposal =>
  async (
    cmd: EditChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>> => {
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

    const outcome = proposal.edit(
      cmd.changes,
      baselineFor(definition, cmd.changes),
      cmd.comment,
      deps.clock.now(),
    );
    if (outcome.isErr) return err(outcome.error);

    await deps.proposals.save(proposal);
    await deps.events.publish(proposal.pullEvents());
    return ok(undefined);
  };
