import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { validateBarcodes } from "./barcode";
import { CatalogError } from "./errors";
import {
  ChangeProposalApproved,
  ChangeProposalEdited,
  ChangeProposalFiled,
  ChangeProposalRejected,
  ChangeProposalWithdrawn,
} from "./events";
import { ChangeProposalId, PuzzleDefinitionId, SubmitterId } from "./ids";
import { PieceCount } from "./piece-count";
import {
  ALLOWED_PROPOSAL_TRANSITIONS,
  ProposalStatus,
} from "./proposal-status";
import type { PuzzleDefinitionChanges } from "./puzzle-definition";

// Input to file(): the field diff a member proposes against an approved definition. `changes`
// is the exact patch definition.update() will receive on approval; `baseline` is a same-shaped
// snapshot of ONLY the changed fields' current values, captured by the application layer at
// file/edit time — it exists purely so review UIs can derive "changed since proposed" markers.
export interface FileChangeProposalProps {
  readonly id: ChangeProposalId;
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly proposedBy: SubmitterId;
  readonly changes: PuzzleDefinitionChanges;
  readonly baseline: PuzzleDefinitionChanges;
  readonly comment?: string;
  readonly now: Date;
}

export interface PuzzleChangeProposalState {
  readonly id: ChangeProposalId;
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly proposedBy: SubmitterId;
  readonly status: ProposalStatus;
  readonly changes: PuzzleDefinitionChanges;
  readonly baseline: PuzzleDefinitionChanges;
  readonly comment?: string;
  readonly rejectionReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly decidedAt?: Date;
}

const hasAnyChange = (changes: PuzzleDefinitionChanges): boolean =>
  Object.values(changes).some((value) => value !== undefined);

// The same invariants PuzzleDefinition.update() enforces (non-blank title, positive integer
// piece count, well-formed barcodes), run at file/edit time so an invalid proposal can never
// sit in the review queue and then fail at approval.
const validateChanges = (
  changes: PuzzleDefinitionChanges,
): Result<void, CatalogError> => {
  if (!hasAnyChange(changes)) return err(CatalogError.emptyProposal());
  if (changes.title !== undefined && changes.title.trim().length === 0) {
    return err(CatalogError.emptyTitle());
  }
  if (changes.pieceCount !== undefined) {
    const validated = PieceCount.create(changes.pieceCount);
    if (validated.isErr) return err(validated.error);
  }
  if (changes.barcodes !== undefined) {
    const validated = validateBarcodes(changes.barcodes);
    if (validated.isErr) return err(validated.error);
  }
  return ok(undefined);
};

export class PuzzleChangeProposal {
  private events: DomainEvent[] = [];

  private constructor(private state: PuzzleChangeProposalState) {}

  get id(): ChangeProposalId {
    return this.state.id;
  }

  get puzzleDefinitionId(): PuzzleDefinitionId {
    return this.state.puzzleDefinitionId;
  }

  get proposedBy(): SubmitterId {
    return this.state.proposedBy;
  }

  get status(): ProposalStatus {
    return this.state.status;
  }

  get changes(): PuzzleDefinitionChanges {
    return this.state.changes;
  }

  // File a new proposal. Validates the diff from its own data only; cross-aggregate rules
  // (definition approved, no open duplicate) are the application layer's, like barcode
  // uniqueness on submit.
  static file(
    props: FileChangeProposalProps,
  ): Result<PuzzleChangeProposal, CatalogError> {
    const validated = validateChanges(props.changes);
    if (validated.isErr) return err(validated.error);

    const state: PuzzleChangeProposalState = {
      id: props.id,
      puzzleDefinitionId: props.puzzleDefinitionId,
      proposedBy: props.proposedBy,
      status: "pending",
      changes: props.changes,
      baseline: props.baseline,
      comment: props.comment,
      createdAt: props.now,
      updatedAt: props.now,
    };
    const proposal = new PuzzleChangeProposal(state);
    proposal.record(
      new ChangeProposalFiled(
        state.id,
        state.puzzleDefinitionId,
        state.proposedBy,
        props.now,
      ),
    );
    return ok(proposal);
  }

  // Replace the diff/baseline/comment in place (the proposer's "full editing" flow). Only a
  // pending proposal is editable; the new diff is re-validated exactly like file().
  edit(
    changes: PuzzleDefinitionChanges,
    baseline: PuzzleDefinitionChanges,
    comment: string | undefined,
    now: Date,
  ): Result<void, CatalogError> {
    if (this.state.status !== "pending") {
      return err(CatalogError.proposalNotPending(this.state.status));
    }
    const validated = validateChanges(changes);
    if (validated.isErr) return err(validated.error);

    this.state = { ...this.state, changes, baseline, comment, updatedAt: now };
    this.record(
      new ChangeProposalEdited(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        now,
      ),
    );
    return ok(undefined);
  }

  // Proposer retracts a pending proposal. Terminal; re-filing creates a new proposal.
  withdraw(now: Date): Result<void, CatalogError> {
    const moved = this.transition("withdrawn", now);
    if (moved.isErr) return moved;
    this.record(
      new ChangeProposalWithdrawn(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        now,
      ),
    );
    return ok(undefined);
  }

  // Admin accepts the proposal. Applying the patch to the definition is the approve use case's
  // orchestration; this aggregate only owns its own lifecycle.
  approve(now: Date): Result<void, CatalogError> {
    const moved = this.transition("approved", now);
    if (moved.isErr) return moved;
    this.state = { ...this.state, decidedAt: now };
    this.record(
      new ChangeProposalApproved(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        now,
      ),
    );
    return ok(undefined);
  }

  // Admin declines the proposal, optionally explaining why (surfaced to the proposer).
  reject(reason: string | undefined, now: Date): Result<void, CatalogError> {
    const moved = this.transition("rejected", now);
    if (moved.isErr) return moved;
    this.state = { ...this.state, rejectionReason: reason, decidedAt: now };
    this.record(
      new ChangeProposalRejected(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        reason,
        now,
      ),
    );
    return ok(undefined);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: PuzzleChangeProposalState): PuzzleChangeProposal {
    return new PuzzleChangeProposal(state);
  }

  toState(): PuzzleChangeProposalState {
    return this.state;
  }

  // --- internals ---

  // The ONLY place status changes. Rejects any move not in the allow-list.
  private transition(
    to: ProposalStatus,
    now: Date,
  ): Result<void, CatalogError> {
    if (!ALLOWED_PROPOSAL_TRANSITIONS[this.state.status].includes(to)) {
      return err(CatalogError.illegalProposalTransition(this.state.status, to));
    }
    this.state = { ...this.state, status: to, updatedAt: now };
    return ok(undefined);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
