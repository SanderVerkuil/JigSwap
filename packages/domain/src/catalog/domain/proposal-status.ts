// Lifecycle of a PuzzleChangeProposal. A member files it `pending`; an admin decides it once
// (approved/rejected) or the proposer withdraws it. All non-pending states are terminal —
// a member who wants to try again files a NEW proposal.
export type ProposalStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const ALLOWED_PROPOSAL_TRANSITIONS: Readonly<
  Record<ProposalStatus, readonly ProposalStatus[]>
> = {
  pending: ["approved", "rejected", "withdrawn"],
  approved: [],
  rejected: [],
  withdrawn: [],
};
