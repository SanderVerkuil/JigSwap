import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { SolvingError } from "./errors";
import { GoalAchieved, GoalCreated, GoalProgressed } from "./events";
import { GoalId, MemberId } from "./ids";

// Input to create(): a member's new completion-count goal.
export interface CreateGoalProps {
  readonly id: GoalId;
  readonly userId: MemberId;
  readonly title: string;
  readonly description?: string;
  readonly targetCompletions: number;
  readonly targetDate?: Date;
  readonly now: Date;
}

// The persistable shape, kept close to the `goals` columns so the 2c mapper is a near
// field-for-field translation (userId, title, description, targetCompletions, currentCompletions,
// targetDate, isActive, createdAt, updatedAt).
export interface GoalState {
  readonly id: GoalId;
  readonly userId: MemberId;
  readonly title: string;
  readonly description?: string;
  readonly targetCompletions: number;
  readonly currentCompletions: number;
  readonly targetDate?: Date;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// The Goal aggregate root: a member's target number of completions (optionally by a deadline).
//
// Invariant: `currentCompletions` is DERIVED from completions, never hand-set — progressTo()
// takes the authoritative count recomputed from the member's completions (an application concern
// driven by CompletionRecorded). Achievement (current ≥ target) is computed, and GoalAchieved is
// emitted exactly once, the moment progress first crosses the target. `targetCompletions` is a
// positive integer.
export class Goal {
  private events: DomainEvent[] = [];

  private constructor(private state: GoalState) {}

  get id(): GoalId {
    return this.state.id;
  }

  get userId(): MemberId {
    return this.state.userId;
  }

  get currentCompletions(): number {
    return this.state.currentCompletions;
  }

  get targetCompletions(): number {
    return this.state.targetCompletions;
  }

  // True once progress reaches the target — a computed property, never a stored flag.
  get isAchieved(): boolean {
    return this.state.currentCompletions >= this.state.targetCompletions;
  }

  get isActive(): boolean {
    return this.state.isActive;
  }

  static create(props: CreateGoalProps): Result<Goal, SolvingError> {
    if (
      !Number.isInteger(props.targetCompletions) ||
      props.targetCompletions <= 0
    ) {
      return err(SolvingError.invalidGoalTarget());
    }

    const goal = new Goal({
      id: props.id,
      userId: props.userId,
      title: props.title,
      description: props.description,
      targetCompletions: props.targetCompletions,
      currentCompletions: 0,
      targetDate: props.targetDate,
      isActive: true,
      createdAt: props.now,
      updatedAt: props.now,
    });
    goal.record(
      new GoalCreated(props.id, props.userId, props.targetCompletions, props.now),
    );
    return ok(goal);
  }

  // Set the derived progress to the authoritative count recomputed from the member's completions.
  // A no-op (same count) records nothing. Emits GoalProgressed whenever the count changes, and
  // GoalAchieved exactly once — only on the transition that first crosses the target (so a later
  // recompute that stays at/above the target does NOT re-fire it).
  progressTo(count: number, now: Date): Result<void, SolvingError> {
    if (!Number.isInteger(count) || count < 0) {
      return err(SolvingError.invalidGoalTarget());
    }
    const previous = this.state.currentCompletions;
    if (count === previous) return ok(undefined);

    const wasAchieved = previous >= this.state.targetCompletions;
    this.state = {
      ...this.state,
      currentCompletions: count,
      updatedAt: now,
    };
    this.record(
      new GoalProgressed(
        this.state.id,
        this.state.userId,
        count,
        this.state.targetCompletions,
        now,
      ),
    );

    const nowAchieved = count >= this.state.targetCompletions;
    if (nowAchieved && !wasAchieved) {
      this.record(
        new GoalAchieved(
          this.state.id,
          this.state.userId,
          this.state.targetCompletions,
          now,
        ),
      );
    }
    return ok(undefined);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: GoalState): Goal {
    return new Goal(state);
  }

  toState(): GoalState {
    return this.state;
  }

  // --- internals ---

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
