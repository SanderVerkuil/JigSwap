import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { SolvingError } from "./errors";
import {
  CompletionEdited,
  CompletionRecorded,
  CompletionStarted,
  PuzzleReviewed,
} from "./events";
import { CompletionId, CopyId, MemberId, PuzzleDefinitionId } from "./ids";
import { Photo } from "./photo";
import { PuzzleReview } from "./puzzle-review";
import { SolveDuration } from "./solve-duration";
import { StarRating } from "./star-rating";

// A completion may hold at most five photos (§1.4).
export const MAX_PHOTOS = 5;

// Edits are only allowed within this window after the completion was recorded (documented rule).
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Input to start(): an in-progress solve (no end yet).
export interface StartCompletionProps {
  readonly id: CompletionId;
  readonly userId: MemberId;
  readonly puzzleDefinitionId?: PuzzleDefinitionId;
  readonly copyId?: CopyId;
  readonly startDate: Date;
  readonly notes?: string;
  readonly photos?: readonly Photo[];
  readonly allPiecesPresent?: boolean;
  readonly now: Date;
}

// Input to record(): an already-finished solve logged after the fact.
export interface RecordCompletionProps {
  readonly id: CompletionId;
  readonly userId: MemberId;
  readonly puzzleDefinitionId?: PuzzleDefinitionId;
  readonly copyId?: CopyId;
  readonly startDate: Date;
  readonly endDate: Date;
  // If omitted, the duration is derived from start/end.
  readonly completionTimeMinutes?: number;
  readonly notes?: string;
  readonly photos?: readonly Photo[];
  readonly review?: PuzzleReview;
  readonly allPiecesPresent?: boolean;
  readonly now: Date;
}

// The persistable shape, kept close to the `completions` columns so the 2c mapper is a
// near field-for-field translation:
//   userId, puzzleId→puzzleDefinitionId, ownedPuzzleId→copyId, startDate, endDate,
//   completionTimeMinutes, rating→review.rating, review(text)→review.text, notes, photos[],
//   isCompleted, createdAt, updatedAt.
export interface CompletionState {
  readonly id: CompletionId;
  readonly userId: MemberId;
  readonly puzzleDefinitionId?: PuzzleDefinitionId;
  readonly copyId?: CopyId;
  readonly startDate: Date;
  readonly endDate?: Date;
  readonly completionTimeMinutes?: number;
  readonly notes?: string;
  readonly photos: readonly Photo[];
  readonly review?: PuzzleReview;
  readonly allPiecesPresent?: boolean;
  readonly isCompleted: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Changes accepted by edit(). An undefined field leaves the current value untouched.
export interface CompletionChanges {
  readonly notes?: string;
  readonly photos?: readonly Photo[];
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly completionTimeMinutes?: number;
}

// The Completion aggregate root (a SolveSession): a member's record of solving one puzzle. It
// references the puzzle by id (a PuzzleDefinitionId and/or a CopyId) and never loads those
// aggregates. It can be in-progress (no end, isCompleted=false) or done (end + duration).
//
// Invariants: endDate ≥ startDate; the duration is consistent with the recorded end; at most
// five photos; edits only within 24h of completion.
export class Completion {
  private events: DomainEvent[] = [];

  private constructor(private state: CompletionState) {}

  get id(): CompletionId {
    return this.state.id;
  }

  get userId(): MemberId {
    return this.state.userId;
  }

  get isCompleted(): boolean {
    return this.state.isCompleted;
  }

  get puzzleReview(): PuzzleReview | undefined {
    return this.state.review;
  }

  get photos(): readonly Photo[] {
    return this.state.photos;
  }

  // Begin an in-progress solve. No end/duration yet; records CompletionStarted.
  static start(props: StartCompletionProps): Result<Completion, SolvingError> {
    const photos = props.photos ?? [];
    if (photos.length > MAX_PHOTOS) {
      return err(SolvingError.tooManyPhotos(MAX_PHOTOS));
    }

    const completion = new Completion({
      id: props.id,
      userId: props.userId,
      puzzleDefinitionId: props.puzzleDefinitionId,
      copyId: props.copyId,
      startDate: props.startDate,
      notes: props.notes,
      photos,
      allPiecesPresent: props.allPiecesPresent,
      isCompleted: false,
      createdAt: props.now,
      updatedAt: props.now,
    });
    completion.record(
      new CompletionStarted(
        props.id,
        props.userId,
        props.puzzleDefinitionId,
        props.copyId,
        props.startDate,
        props.now,
      ),
    );
    return ok(completion);
  }

  // Log an already-finished solve. Enforces endDate ≥ startDate, the photo cap, and a duration
  // consistent with start/end; records CompletionRecorded (and PuzzleReviewed if a review came
  // along).
  static record(
    props: RecordCompletionProps,
  ): Result<Completion, SolvingError> {
    if (props.endDate.getTime() < props.startDate.getTime()) {
      return err(SolvingError.invalidTimeRange());
    }
    const photos = props.photos ?? [];
    if (photos.length > MAX_PHOTOS) {
      return err(SolvingError.tooManyPhotos(MAX_PHOTOS));
    }

    const duration = Completion.resolveDuration(
      props.startDate,
      props.endDate,
      props.completionTimeMinutes,
    );
    if (duration.isErr) return err(duration.error);

    const completion = new Completion({
      id: props.id,
      userId: props.userId,
      puzzleDefinitionId: props.puzzleDefinitionId,
      copyId: props.copyId,
      startDate: props.startDate,
      endDate: props.endDate,
      completionTimeMinutes: duration.value.minutes,
      notes: props.notes,
      photos,
      review: props.review,
      allPiecesPresent: props.allPiecesPresent,
      isCompleted: true,
      createdAt: props.now,
      updatedAt: props.now,
    });
    completion.record(
      new CompletionRecorded(
        props.id,
        props.userId,
        props.puzzleDefinitionId,
        props.copyId,
        props.startDate,
        props.endDate,
        duration.value.minutes,
        props.now,
      ),
    );
    if (props.review) {
      completion.record(
        new PuzzleReviewed(
          props.id,
          props.userId,
          props.puzzleDefinitionId,
          props.review.rating.value,
          props.now,
        ),
      );
    }
    return ok(completion);
  }

  // Finish an in-progress completion. Idempotent guard: finishing an already-finished completion
  // is treated as a no-op so a double-submit can't double-emit CompletionRecorded.
  finish(
    endDate: Date,
    now: Date,
    completionTimeMinutes?: number,
    allPiecesPresent?: boolean,
  ): Result<void, SolvingError> {
    if (this.state.isCompleted) return ok(undefined);
    if (endDate.getTime() < this.state.startDate.getTime()) {
      return err(SolvingError.invalidTimeRange());
    }
    const duration = Completion.resolveDuration(
      this.state.startDate,
      endDate,
      completionTimeMinutes,
    );
    if (duration.isErr) return err(duration.error);

    this.state = {
      ...this.state,
      endDate,
      completionTimeMinutes: duration.value.minutes,
      allPiecesPresent: allPiecesPresent ?? this.state.allPiecesPresent,
      isCompleted: true,
      updatedAt: now,
    };
    this.record(
      new CompletionRecorded(
        this.state.id,
        this.state.userId,
        this.state.puzzleDefinitionId,
        this.state.copyId,
        this.state.startDate,
        endDate,
        duration.value.minutes,
        now,
      ),
    );
    return ok(undefined);
  }

  // Patch mutable fields. Allowed only within 24h of completion (EditWindowClosed otherwise) and
  // only by the owner (the use case checks ownership; this is the aggregate-level signal). An
  // undefined field in `changes` leaves the current value untouched.
  edit(
    actingMemberId: MemberId,
    changes: CompletionChanges,
    now: Date,
  ): Result<void, SolvingError> {
    if (actingMemberId !== this.state.userId) {
      return err(SolvingError.notCompletionOwner());
    }
    // The edit window is anchored on the recorded completion. An in-progress completion has no
    // completion instant yet, so it is always editable.
    if (this.state.isCompleted) {
      const reference = this.state.endDate ?? this.state.updatedAt;
      if (now.getTime() - reference.getTime() > EDIT_WINDOW_MS) {
        return err(SolvingError.editWindowClosed());
      }
    }

    const nextStart = changes.startDate ?? this.state.startDate;
    const nextEnd =
      changes.endDate !== undefined ? changes.endDate : this.state.endDate;
    if (nextEnd && nextEnd.getTime() < nextStart.getTime()) {
      return err(SolvingError.invalidTimeRange());
    }

    const nextPhotos = changes.photos ?? this.state.photos;
    if (nextPhotos.length > MAX_PHOTOS) {
      return err(SolvingError.tooManyPhotos(MAX_PHOTOS));
    }

    let nextDuration = this.state.completionTimeMinutes;
    if (
      changes.completionTimeMinutes !== undefined ||
      changes.startDate !== undefined ||
      changes.endDate !== undefined
    ) {
      if (nextEnd) {
        const duration = Completion.resolveDuration(
          nextStart,
          nextEnd,
          changes.completionTimeMinutes,
        );
        if (duration.isErr) return err(duration.error);
        nextDuration = duration.value.minutes;
      } else if (changes.completionTimeMinutes !== undefined) {
        const duration = SolveDuration.ofMinutes(changes.completionTimeMinutes);
        if (duration.isErr) return err(duration.error);
        nextDuration = duration.value.minutes;
      }
    }

    this.state = {
      ...this.state,
      notes: changes.notes ?? this.state.notes,
      photos: nextPhotos,
      startDate: nextStart,
      endDate: nextEnd,
      completionTimeMinutes: nextDuration,
      updatedAt: now,
    };
    this.record(new CompletionEdited(this.state.id, now));
    return ok(undefined);
  }

  // Attach a PuzzleReview (opinion of the puzzle). Records PuzzleReviewed. Re-reviewing replaces
  // the prior opinion and records the event again (a member can change their mind).
  review(
    rating: StarRating,
    now: Date,
    text?: string,
  ): Result<void, SolvingError> {
    const puzzleReview = PuzzleReview.create(rating, text);
    this.state = { ...this.state, review: puzzleReview, updatedAt: now };
    this.record(
      new PuzzleReviewed(
        this.state.id,
        this.state.userId,
        this.state.puzzleDefinitionId,
        rating.value,
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
  static rehydrate(state: CompletionState): Completion {
    return new Completion(state);
  }

  toState(): CompletionState {
    return this.state;
  }

  // --- internals ---

  // Reconcile a supplied duration with the start/end span. When no duration is supplied it is
  // derived from the span; when one is supplied it must still be a valid positive duration.
  private static resolveDuration(
    start: Date,
    end: Date,
    minutes?: number,
  ): Result<SolveDuration, SolvingError> {
    if (minutes === undefined) {
      return SolveDuration.between(start, end);
    }
    return SolveDuration.ofMinutes(minutes);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
