import { Result } from "../../../../shared-kernel";
import { CatalogError, ChangeProposalId } from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// Admin decisions on a pending proposal. `now` comes from the Clock port, not the command; the
// deciding admin is stamped into moderationActions at the composition root, never here.
export interface ApproveChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
}

export interface RejectChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
  readonly reason?: string;
}

export type DecideChangeProposalResult = Result<
  void,
  CatalogError | CatalogApplicationError
>;

export interface ApproveChangeProposal {
  (cmd: ApproveChangeProposalCommand): Promise<DecideChangeProposalResult>;
}

export interface RejectChangeProposal {
  (cmd: RejectChangeProposalCommand): Promise<DecideChangeProposalResult>;
}
