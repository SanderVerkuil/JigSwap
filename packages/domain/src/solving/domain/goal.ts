import {
  DomainEvent,
  err,
  hasVisibleCharacter,
  ok,
  Result,
} from "../../shared-kernel";
import { SolvingError } from "./errors";
import { GoalAchieved, GoalCreated, GoalProgressed } from "./events";
import {
  countTowardGoal,
  goalCountingWindow,
  GoalSolve,
  GoalWindow,
} from "./goal-progress";
import { GoalId, MemberId } from "./ids";

export const MAX_GOAL_TITLE_LENGTH = 100;
export const MAX_GOAL_DESCRIPTION_LENGTH = 1000;

// What a member decides about a goal: its wording, its target and the period it counts solves in.
// `startDate` and `targetDate` are calendar dates (UTC midnight). Without a `startDate` the goal
// counts from the day it was created; without a `targetDate` it is open-ended.
export interface GoalDefinition {
  readonly title: string;
  readonly description?: string;
  readonly targetCompletions: number;
  readonly startDate?: Date;
  readonly targetDate?: Date;
}

// Input to create(): a member's new completion-count goal.
export interface CreateGoalProps extends GoalDefinition {
  readonly id: GoalId;
  readonly userId: MemberId;
  readonly now: Date;
}

// The persistable shape, kept close to the `goals` columns so the 2c mapper is a near
// field-for-field translation (userId, title, description, targetCompletions, currentCompletions,
// startDate, targetDate, achievementAnnouncedAt, isActive, createdAt, updatedAt).
export interface GoalState {
  readonly id: GoalId;
  readonly userId: MemberId;
  readonly title: string;
  readonly description?: string;
  readonly targetCompletions: number;
  readonly currentCompletions: number;
  readonly startDate?: Date;
  readonly targetDate?: Date;
  // When GoalAchieved went out for the current target; unset until then.
  readonly achievementAnnouncedAt?: Date;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// The Goal aggregate root: a member's target number of completions within a period.
//
// Invariants: `currentCompletions` is DERIVED, never hand-set: it is always the number of the
// member's finished solves that fall inside the goal's counting window (see goal-progress), so a
// goal never counts solves from before it started or after it ended. progressFrom() is the
// announced path (driven by completion changes) and emits GoalAchieved at most once per target,
// the moment progress first crosses it; recount() is the silent path (creating, editing or
// restoring a goal), which never announces anything. The title shows at least one visible character, title
// and description stay within their limits, `targetCompletions` is a positive integer and the
// period is real and never empty (start day on or before the target day). An archived goal
// (`isActive` false) is left alone by progressFrom's callers.
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

  // The span this goal counts solves in.
  get countingWindow(): GoalWindow {
    return goalCountingWindow(this.state);
  }

  static create(props: CreateGoalProps): Result<Goal, SolvingError> {
    const invalid = Goal.validate(props, props.now);
    if (invalid) return err(invalid);

    const goal = new Goal({
      id: props.id,
      userId: props.userId,
      title: props.title,
      description: props.description,
      targetCompletions: props.targetCompletions,
      currentCompletions: 0,
      startDate: props.startDate,
      targetDate: props.targetDate,
      isActive: true,
      createdAt: props.now,
      updatedAt: props.now,
    });
    goal.record(
      new GoalCreated(
        props.id,
        props.userId,
        props.targetCompletions,
        props.now,
      ),
    );
    return ok(goal);
  }

  // Replace what the member decided (title, description, target, period). Fields the new
  // definition leaves out are cleared. Records nothing: the caller recounts silently, so changing
  // a goal never announces an achievement. A changed target is a new thing to reach, so it can be
  // announced in its turn.
  edit(definition: GoalDefinition, now: Date): Result<void, SolvingError> {
    const invalid = Goal.validate(definition, this.state.createdAt);
    if (invalid) return err(invalid);

    this.state = {
      ...this.state,
      title: definition.title,
      description: definition.description,
      targetCompletions: definition.targetCompletions,
      startDate: definition.startDate,
      targetDate: definition.targetDate,
      achievementAnnouncedAt:
        definition.targetCompletions === this.state.targetCompletions
          ? this.state.achievementAnnouncedAt
          : undefined,
      updatedAt: now,
    };
    return ok(undefined);
  }

  // Retire the goal: it stops following new solves. A no-op when already archived.
  archive(now: Date): void {
    if (!this.state.isActive) return;
    this.state = { ...this.state, isActive: false, updatedAt: now };
  }

  // Bring an archived goal back. A no-op when already active. The caller recounts it, since it
  // missed every solve while archived.
  restore(now: Date): void {
    if (this.state.isActive) return;
    this.state = { ...this.state, isActive: true, updatedAt: now };
  }

  // Set the derived progress to the number of `solves` inside this goal's window, announcing it.
  // A no-op (same count) records nothing. Emits GoalProgressed whenever the count changes, and
  // GoalAchieved at most once per target: only on the transition that first crosses it. A later
  // recompute that stays at or above the target doesn't re-fire it, and neither does dropping below
  // it and crossing it again (a solve's date edited out and back, or a solve deleted and re-logged).
  progressFrom(solves: readonly GoalSolve[], now: Date): void {
    const count = countTowardGoal(solves, this.countingWindow);
    const previous = this.state.currentCompletions;
    if (count === previous) return;

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
    if (
      nowAchieved &&
      !wasAchieved &&
      this.state.achievementAnnouncedAt === undefined
    ) {
      this.state = { ...this.state, achievementAnnouncedAt: now };
      this.record(
        new GoalAchieved(
          this.state.id,
          this.state.userId,
          this.state.targetCompletions,
          now,
        ),
      );
    }
  }

  // Silently correct the derived progress to the number of `solves` inside this goal's window:
  // no GoalProgressed, no GoalAchieved. Used when the goal itself changes (created, edited,
  // restored), which is not a solve the member should be congratulated on.
  recount(solves: readonly GoalSolve[], now: Date): void {
    const count = countTowardGoal(solves, this.countingWindow);
    if (count === this.state.currentCompletions) return;
    this.state = { ...this.state, currentCompletions: count, updatedAt: now };
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

  // A definition is valid with a title that shows something, wording within the limits, a positive
  // integer target and a real, non-empty period, measured from its start date or, without one, from
  // `createdAt`.
  private static validate(
    definition: GoalDefinition,
    createdAt: Date,
  ): SolvingError | undefined {
    if (
      !hasVisibleCharacter(definition.title) ||
      definition.title.length > MAX_GOAL_TITLE_LENGTH
    ) {
      return SolvingError.invalidGoalTitle(MAX_GOAL_TITLE_LENGTH);
    }
    if (
      definition.description !== undefined &&
      definition.description.length > MAX_GOAL_DESCRIPTION_LENGTH
    ) {
      return SolvingError.invalidGoalDescription(MAX_GOAL_DESCRIPTION_LENGTH);
    }
    if (
      !Number.isInteger(definition.targetCompletions) ||
      definition.targetCompletions <= 0
    ) {
      return SolvingError.invalidGoalTarget();
    }
    const window = goalCountingWindow({ ...definition, createdAt });
    const from = window.from.getTime();
    const toExclusive = window.toExclusive?.getTime();
    if (
      Number.isNaN(from) ||
      (toExclusive !== undefined &&
        (Number.isNaN(toExclusive) || toExclusive <= from))
    ) {
      return SolvingError.invalidGoalPeriod();
    }
    return undefined;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
