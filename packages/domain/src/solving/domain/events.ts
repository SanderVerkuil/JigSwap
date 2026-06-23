import { DomainEvent } from "../../shared-kernel";
import {
  CompletionId,
  CopyId,
  GoalId,
  MemberId,
  PuzzleDefinitionId,
} from "./ids";

// All Solving domain events implement DomainEvent (name + occurredAt). They are plain immutable
// records: an aggregate records them; an outbound publisher (2c) serialises and dispatches them
// to subscribers (Insights stats, Social activity feed, Notifications, and a Goal-progress
// reactor inside this context).

// A member began an in-progress solve. Carries no end/duration yet.
export class CompletionStarted implements DomainEvent {
  readonly name = "CompletionStarted";
  constructor(
    readonly completionId: CompletionId,
    readonly userId: MemberId,
    readonly puzzleDefinitionId: PuzzleDefinitionId | undefined,
    readonly copyId: CopyId | undefined,
    readonly startDate: Date,
    readonly occurredAt: Date,
  ) {}
}

// A solve was finished (or recorded already-finished). This is the event that drives goal
// progress and feeds activity feeds — the marketing "completed a puzzle" moment.
export class CompletionRecorded implements DomainEvent {
  readonly name = "CompletionRecorded";
  constructor(
    readonly completionId: CompletionId,
    readonly userId: MemberId,
    readonly puzzleDefinitionId: PuzzleDefinitionId | undefined,
    readonly copyId: CopyId | undefined,
    readonly startDate: Date,
    readonly endDate: Date,
    readonly completionTimeMinutes: number | undefined,
    readonly occurredAt: Date,
  ) {}
}

// Mutable fields (notes/photos/duration/dates) of a completion were edited within the 24h window.
export class CompletionEdited implements DomainEvent {
  readonly name = "CompletionEdited";
  constructor(
    readonly completionId: CompletionId,
    readonly occurredAt: Date,
  ) {}
}

// A completion was deleted by its owner (e.g. logged by accident). The userId is carried so the
// goal-progress reactor can recompute the member's derived goal progress in the same transaction.
export class CompletionDeleted implements DomainEvent {
  readonly name = "CompletionDeleted";
  constructor(
    readonly completionId: CompletionId,
    readonly userId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// A PuzzleReview (opinion of the puzzle) was attached to a completion.
export class PuzzleReviewed implements DomainEvent {
  readonly name = "PuzzleReviewed";
  constructor(
    readonly completionId: CompletionId,
    readonly userId: MemberId,
    readonly puzzleDefinitionId: PuzzleDefinitionId | undefined,
    readonly rating: number,
    readonly occurredAt: Date,
  ) {}
}

export class GoalCreated implements DomainEvent {
  readonly name = "GoalCreated";
  constructor(
    readonly goalId: GoalId,
    readonly userId: MemberId,
    readonly targetCompletions: number,
    readonly occurredAt: Date,
  ) {}
}

// The derived progress count changed (recomputed from completions). Carries the new count so a
// read model never has to recompute it.
export class GoalProgressed implements DomainEvent {
  readonly name = "GoalProgressed";
  constructor(
    readonly goalId: GoalId,
    readonly userId: MemberId,
    readonly currentCompletions: number,
    readonly targetCompletions: number,
    readonly occurredAt: Date,
  ) {}
}

// Emitted exactly once, the moment progress first crosses the target.
export class GoalAchieved implements DomainEvent {
  readonly name = "GoalAchieved";
  constructor(
    readonly goalId: GoalId,
    readonly userId: MemberId,
    readonly targetCompletions: number,
    readonly occurredAt: Date,
  ) {}
}

export type SolvingDomainEvent =
  | CompletionStarted
  | CompletionRecorded
  | CompletionEdited
  | CompletionDeleted
  | PuzzleReviewed
  | GoalCreated
  | GoalProgressed
  | GoalAchieved;
