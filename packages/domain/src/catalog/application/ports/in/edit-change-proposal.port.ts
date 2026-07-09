import { Result } from "../../../../shared-kernel";
import {
  CatalogError,
  ChangeProposalId,
  PuzzleDefinitionChanges,
} from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to replace a pending proposal's diff/comment in place. Like filing, the baseline
// is re-derived server-side against the definition's CURRENT state.
export interface EditChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
  readonly changes: PuzzleDefinitionChanges;
  readonly comment?: string;
}

// Inbound port: the edit-change-proposal use case.
export interface EditChangeProposal {
  (
    cmd: EditChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>>;
}
