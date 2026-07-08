import { Result } from "../../../../shared-kernel";
import {
  CatalogError,
  ChangeProposalId,
  PuzzleDefinitionChanges,
  PuzzleDefinitionId,
  SubmitterId,
} from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to file a community change proposal against an approved definition. The baseline
// snapshot is NOT part of the command: the use case derives it server-side from the definition's
// current state, so a stale client can never forge "what the proposer saw".
export interface FileChangeProposalCommand {
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly proposedBy: SubmitterId;
  readonly changes: PuzzleDefinitionChanges;
  readonly comment?: string;
}

// Inbound port: the file-change-proposal use case. Succeeds with the new proposal's id.
export interface FileChangeProposal {
  (
    cmd: FileChangeProposalCommand,
  ): Promise<Result<ChangeProposalId, CatalogError | CatalogApplicationError>>;
}
