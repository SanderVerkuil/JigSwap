import { Result } from "../../../../shared-kernel";
import { CatalogError, ChangeProposalId } from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// Admin decisions on a pending proposal. `now` comes from the Clock port, not the command; the
// deciding admin is stamped into moderationActions at the composition root, never here.
export interface ApproveChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
  // The proposal's updatedAt as the admin reviewed it. When given, the approval is refused
  // (ChangeProposalChanged) if the proposer edited the proposal since, so an admin never
  // approves a diff they did not see.
  readonly expectedUpdatedAt?: Date;
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
