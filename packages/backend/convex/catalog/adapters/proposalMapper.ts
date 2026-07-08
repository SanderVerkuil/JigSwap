import {
  type PuzzleChangeProposalState,
  type PuzzleDefinitionChanges,
  PuzzleChangeProposal,
  toCatalogCategoryId,
  toChangeProposalId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `puzzleChangeProposals` row and the PuzzleChangeProposal aggregate.
// Schema shape stops here and never ripples into the domain.

export type ProposalRow = Omit<
  Doc<"puzzleChangeProposals">,
  "_id" | "_creationTime"
>;

type FieldsColumn = Doc<"puzzleChangeProposals">["changes"];

// The stored diff column ↔ the domain PuzzleDefinitionChanges. Field-for-field except `category`,
// which is re-branded (both sides carry the aggregate id string).
const toChanges = (column: FieldsColumn): PuzzleDefinitionChanges => ({
  ...column,
  category: column.category ? toCatalogCategoryId(column.category) : undefined,
});

const toColumn = (changes: PuzzleDefinitionChanges): FieldsColumn => ({
  ...changes,
  category: changes.category ? (changes.category as string) : undefined,
  tags: changes.tags ? [...changes.tags] : undefined,
});

export const toDomain = (
  row: Doc<"puzzleChangeProposals">,
): PuzzleChangeProposal =>
  PuzzleChangeProposal.rehydrate({
    id: toChangeProposalId(row.aggregateId),
    puzzleDefinitionId: toPuzzleDefinitionId(row.puzzleDefinitionId),
    proposedBy: toSubmitterId(row.proposedBy as unknown as string),
    status: row.status,
    changes: toChanges(row.changes),
    baseline: toChanges(row.baseline),
    comment: row.comment,
    rejectionReason: row.rejectionReason,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    decidedAt:
      row.decidedAt !== undefined ? new Date(row.decidedAt) : undefined,
  });

export const toRow = (proposal: PuzzleChangeProposal): ProposalRow => {
  const state: PuzzleChangeProposalState = proposal.toState();
  return {
    aggregateId: state.id as string,
    puzzleDefinitionId: state.puzzleDefinitionId as string,
    proposedBy: state.proposedBy as unknown as Id<"users">,
    status: state.status,
    changes: toColumn(state.changes),
    baseline: toColumn(state.baseline),
    comment: state.comment,
    rejectionReason: state.rejectionReason,
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
    decidedAt: state.decidedAt?.getTime(),
  };
};
