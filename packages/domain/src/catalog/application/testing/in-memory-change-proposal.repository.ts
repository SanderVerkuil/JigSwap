import {
  ChangeProposalId,
  PuzzleChangeProposal,
  PuzzleDefinitionId,
  SubmitterId,
} from "../../domain";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";

// In-memory ChangeProposalRepository for use-case tests. Stores persisted state and rehydrates
// a fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryChangeProposalRepository implements ChangeProposalRepository {
  private readonly store = new Map<
    ChangeProposalId,
    ReturnType<PuzzleChangeProposal["toState"]>
  >();

  async findById(id: ChangeProposalId): Promise<PuzzleChangeProposal | null> {
    const state = this.store.get(id);
    return state ? PuzzleChangeProposal.rehydrate(state) : null;
  }

  async findPendingByDefinitionAndProposer(
    definitionId: PuzzleDefinitionId,
    proposer: SubmitterId,
  ): Promise<PuzzleChangeProposal | null> {
    for (const state of this.store.values()) {
      if (
        state.status === "pending" &&
        state.puzzleDefinitionId === definitionId &&
        state.proposedBy === proposer
      ) {
        return PuzzleChangeProposal.rehydrate(state);
      }
    }
    return null;
  }

  async save(proposal: PuzzleChangeProposal): Promise<void> {
    this.store.set(proposal.id, proposal.toState());
  }

  // Test helper: how many proposals are currently stored.
  size(): number {
    return this.store.size;
  }
}
