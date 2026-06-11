import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { ALLOWED_APPROVAL_TRANSITIONS, ApprovalStatus } from "./approval";
import { BarcodesInput, validateBarcodes } from "./barcode";
import { CatalogError } from "./errors";
import {
  PuzzleDefinitionApproved,
  PuzzleDefinitionRejected,
  PuzzleDefinitionSubmitted,
  PuzzleDefinitionUpdated,
} from "./events";
import { CatalogCategoryId, PuzzleDefinitionId, SubmitterId } from "./ids";
import { Difficulty, Dimensions, PieceCount, Shape } from "./piece-count";

// Input to submit(): the authored product facts. Barcodes/pieceCount arrive raw and are
// validated; the descriptive fields are plain optional strings copied straight through.
export interface SubmitPuzzleDefinitionProps {
  readonly id: PuzzleDefinitionId;
  readonly title: string;
  readonly pieceCount: number;
  readonly submittedBy: SubmitterId;
  readonly now: Date;
  readonly description?: string;
  readonly brand?: string;
  readonly artist?: string;
  readonly series?: string;
  readonly barcodes?: BarcodesInput;
  readonly dimensions?: Dimensions;
  readonly shape?: Shape;
  readonly difficulty?: Difficulty;
  readonly category?: CatalogCategoryId;
  readonly tags?: readonly string[];
  readonly image?: string; // storage ref
}

// The descriptive fields a moderator/submitter may patch via update(). All optional; an
// explicit value replaces the field. (Approval status and provenance are not patchable here.)
export interface PuzzleDefinitionChanges {
  readonly title?: string;
  readonly pieceCount?: number;
  readonly description?: string;
  readonly brand?: string;
  readonly artist?: string;
  readonly series?: string;
  readonly barcodes?: BarcodesInput;
  readonly dimensions?: Dimensions;
  readonly shape?: Shape;
  readonly difficulty?: Difficulty;
  readonly category?: CatalogCategoryId;
  readonly tags?: readonly string[];
  readonly image?: string;
}

// The persistable shape, kept deliberately close to the `puzzles` table columns so the
// Phase-2c mapper is a trivial field-for-field translation. `searchableText` is intentionally
// NOT stored here: it is a derived projection (see searchableText()), recomputed by the adapter.
export interface PuzzleDefinitionState {
  readonly id: PuzzleDefinitionId;
  readonly title: string;
  readonly description?: string;
  readonly brand?: string;
  readonly pieceCount: number;
  readonly artist?: string;
  readonly series?: string;
  readonly ean?: string;
  readonly upc?: string;
  readonly modelNumber?: string;
  readonly dimensions?: Dimensions;
  readonly shape?: Shape;
  readonly difficulty?: Difficulty;
  readonly category?: CatalogCategoryId;
  readonly tags?: readonly string[];
  readonly image?: string;
  readonly status: ApprovalStatus;
  readonly submittedBy: SubmitterId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PuzzleDefinition {
  private events: DomainEvent[] = [];

  private constructor(private state: PuzzleDefinitionState) {}

  get id(): PuzzleDefinitionId {
    return this.state.id;
  }

  get status(): ApprovalStatus {
    return this.state.status;
  }

  // Submit a brand-new definition. Validates from its own data only: non-blank title,
  // positive piece count, well-formed barcodes; starts `pending`. Barcode UNIQUENESS is a
  // cross-aggregate rule (a repository lookup) enforced in the application layer, not here.
  static submit(
    props: SubmitPuzzleDefinitionProps,
  ): Result<PuzzleDefinition, CatalogError> {
    if (props.title.trim().length === 0) return err(CatalogError.emptyTitle());

    const pieceCount = PieceCount.create(props.pieceCount);
    if (pieceCount.isErr) return err(pieceCount.error);

    const barcodes = validateBarcodes(props.barcodes ?? {});
    if (barcodes.isErr) return err(barcodes.error);

    const state: PuzzleDefinitionState = {
      id: props.id,
      title: props.title.trim(),
      description: props.description,
      brand: props.brand,
      pieceCount: pieceCount.value.value,
      artist: props.artist,
      series: props.series,
      ean: barcodes.value.ean?.value,
      upc: barcodes.value.upc?.value,
      modelNumber: barcodes.value.modelNumber?.value,
      dimensions: props.dimensions,
      shape: props.shape,
      difficulty: props.difficulty,
      category: props.category,
      tags: props.tags,
      image: props.image,
      status: "pending",
      submittedBy: props.submittedBy,
      createdAt: props.now,
      updatedAt: props.now,
    };
    const definition = new PuzzleDefinition(state);
    definition.record(
      new PuzzleDefinitionSubmitted(state.id, state.submittedBy, props.now),
    );
    return ok(definition);
  }

  // Moderator approves a pending submission, making it publicly listable.
  approve(now: Date): Result<void, CatalogError> {
    const moved = this.transition("approved", now);
    if (moved.isErr) return moved;
    this.record(new PuzzleDefinitionApproved(this.id, now));
    return ok(undefined);
  }

  // Moderator rejects a pending submission.
  reject(now: Date): Result<void, CatalogError> {
    const moved = this.transition("rejected", now);
    if (moved.isErr) return moved;
    this.record(new PuzzleDefinitionRejected(this.id, now));
    return ok(undefined);
  }

  // Patch descriptive fields. Re-validates any field with an invariant (title, pieceCount,
  // barcodes). Approval status is untouched. Records one PuzzleDefinitionUpdated.
  update(
    changes: PuzzleDefinitionChanges,
    now: Date,
  ): Result<void, CatalogError> {
    let title = this.state.title;
    if (changes.title !== undefined) {
      if (changes.title.trim().length === 0)
        return err(CatalogError.emptyTitle());
      title = changes.title.trim();
    }

    let pieceCount = this.state.pieceCount;
    if (changes.pieceCount !== undefined) {
      const validated = PieceCount.create(changes.pieceCount);
      if (validated.isErr) return err(validated.error);
      pieceCount = validated.value.value;
    }

    let barcodeFields: Pick<
      PuzzleDefinitionState,
      "ean" | "upc" | "modelNumber"
    > = {
      ean: this.state.ean,
      upc: this.state.upc,
      modelNumber: this.state.modelNumber,
    };
    if (changes.barcodes !== undefined) {
      const validated = validateBarcodes(changes.barcodes);
      if (validated.isErr) return err(validated.error);
      barcodeFields = {
        ean: validated.value.ean?.value,
        upc: validated.value.upc?.value,
        modelNumber: validated.value.modelNumber?.value,
      };
    }

    this.state = {
      ...this.state,
      title,
      pieceCount,
      ...barcodeFields,
      description: changes.description ?? this.state.description,
      brand: changes.brand ?? this.state.brand,
      artist: changes.artist ?? this.state.artist,
      series: changes.series ?? this.state.series,
      dimensions: changes.dimensions ?? this.state.dimensions,
      shape: changes.shape ?? this.state.shape,
      difficulty: changes.difficulty ?? this.state.difficulty,
      category: changes.category ?? this.state.category,
      tags: changes.tags ?? this.state.tags,
      image: changes.image ?? this.state.image,
      updatedAt: now,
    };
    this.record(new PuzzleDefinitionUpdated(this.id, now));
    return ok(undefined);
  }

  // Derived projection for full-text search — NEVER authored or stored state. Recomputed on
  // demand from the searchable fields; the persistence adapter materialises it into the
  // `puzzles.searchableText` column.
  searchableText(): string {
    return [
      this.state.title,
      this.state.brand,
      this.state.artist,
      this.state.series,
      ...(this.state.tags ?? []),
    ]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(" ");
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: PuzzleDefinitionState): PuzzleDefinition {
    return new PuzzleDefinition(state);
  }

  toState(): PuzzleDefinitionState {
    return this.state;
  }

  // --- internals ---

  // The ONLY place approval status changes. Rejects any move not in the allow-list.
  private transition(
    to: ApprovalStatus,
    now: Date,
  ): Result<void, CatalogError> {
    if (!ALLOWED_APPROVAL_TRANSITIONS[this.state.status].includes(to)) {
      return err(CatalogError.illegalApprovalTransition(this.state.status, to));
    }
    this.state = { ...this.state, status: to, updatedAt: now };
    return ok(undefined);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
