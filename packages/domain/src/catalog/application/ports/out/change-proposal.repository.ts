import {
  ChangeProposalId,
  PuzzleChangeProposal,
  PuzzleDefinitionId,
  SubmitterId,
} from "../../../domain";

// Outbound port: persistence for the PuzzleChangeProposal aggregate. The convex adapter
// implements this over `ctx.db` (the `puzzleChangeProposals` table) behind a mapper.
export interface ChangeProposalRepository {
  findById(id: ChangeProposalId): Promise<PuzzleChangeProposal | null>;
  // Backs the one-open-proposal-per-(definition, proposer) rule.
  findPendingByDefinitionAndProposer(
    definitionId: PuzzleDefinitionId,
    proposer: SubmitterId,
  ): Promise<PuzzleChangeProposal | null>;
  save(proposal: PuzzleChangeProposal): Promise<void>;
}
