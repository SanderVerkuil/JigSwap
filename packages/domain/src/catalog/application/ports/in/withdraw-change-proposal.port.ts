import { Result } from "../../../../shared-kernel";
import { CatalogError, ChangeProposalId } from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to retract a pending proposal (proposer-only; the ACL sits at the composition root).
export interface WithdrawChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
}

// Inbound port: the withdraw-change-proposal use case.
export interface WithdrawChangeProposal {
  (
    cmd: WithdrawChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>>;
}
