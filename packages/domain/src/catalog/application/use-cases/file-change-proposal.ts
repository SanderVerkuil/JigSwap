import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import {
  CatalogError,
  ChangeProposalId,
  PuzzleChangeProposal,
} from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  FileChangeProposal,
  FileChangeProposalCommand,
} from "../ports/in/file-change-proposal.port";
import { CatalogIdGenerator } from "../ports/out/catalog-id-generator";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";
import { baselineFor } from "./proposal-baseline";

export interface FileChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly definitions: PuzzleDefinitionRepository;
  readonly ids: CatalogIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: enforce the cross-aggregate rules (definition exists AND is approved;
// no open proposal by this proposer), derive the baseline snapshot server-side, then delegate
// the diff's entity rules to the aggregate. Load → act → save → publish.
export const makeFileChangeProposal =
  (deps: FileChangeProposalDeps): FileChangeProposal =>
  async (
    cmd: FileChangeProposalCommand,
  ): Promise<
    Result<ChangeProposalId, CatalogError | CatalogApplicationError>
  > => {
    const definition = await deps.definitions.findById(cmd.puzzleDefinitionId);
    if (!definition) {
      return err(
        CatalogApplicationError.puzzleDefinitionNotFound(
          cmd.puzzleDefinitionId,
        ),
      );
    }
    if (definition.status !== "approved") {
      return err(
        CatalogApplicationError.definitionNotProposable(
          cmd.puzzleDefinitionId,
          definition.status,
        ),
      );
    }

    const open = await deps.proposals.findPendingByDefinitionAndProposer(
      cmd.puzzleDefinitionId,
      cmd.proposedBy,
    );
    if (open) {
      return err(
        CatalogApplicationError.openProposalAlreadyExists(
          cmd.puzzleDefinitionId,
        ),
      );
    }

    const proposal = PuzzleChangeProposal.file({
      id: deps.ids.nextChangeProposalId(),
      puzzleDefinitionId: cmd.puzzleDefinitionId,
      proposedBy: cmd.proposedBy,
      changes: cmd.changes,
      baseline: baselineFor(definition, cmd.changes),
      comment: cmd.comment,
      now: deps.clock.now(),
    });
    if (proposal.isErr) return err(proposal.error);

    await deps.proposals.save(proposal.value);
    await deps.events.publish(proposal.value.pullEvents());
    return ok(proposal.value.id);
  };
